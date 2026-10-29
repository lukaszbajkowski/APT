# ruff: noqa: E501  (długie komunikaty po polsku)
"""Automatyczna poprawa zdjęcia do karty (wg zasad zdjęcia do dowodu): twarz, prosta głowa, kadr, tło, światło.

Wszystko działa na serwerze, bez zewnętrznych usług i bez pobierania modeli: wykrywanie twarzy i oczu
(kaskady Haara z OpenCV), wyprostowanie, kadr 3:4 z głową zajmującą ok. 75% wysokości, jednolite jasne tło
(GrabCut, tylko gdy obecne tło jest nierówne) i delikatne wyrównanie jasności. Zdjęcia, których nie da się
bezpiecznie poprawić (brak twarzy, kilka osób), są odrzucane z komunikatem. Wynik zawsze zatwierdza człowiek.
"""

import io
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import get_settings

OUT_W, OUT_H = 600, 800
HEAD_RATIO = 0.75  # wysokość głowy (czubek – broda) w stosunku do wysokości zdjęcia; norma: 70–80%
HEAD_CENTER = 0.50  # pionowy środek głowy
CROWN_ABOVE_BOX = 0.43  # o ile (wys. ramki twarzy) czubek głowy wystaje nad ramkę z detektora
BG_COLOR = (240, 240, 240)
WORK_MAX = 1600
Image.MAX_IMAGE_PIXELS = 40_000_000


class FixError(ValueError):
    pass


@dataclass
class Note:
    level: str  # ok | warn | error
    text: str


@dataclass
class Result:
    jpeg: bytes
    notes: list[Note] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)


_face = _face2 = _eye = None


def _cascades() -> tuple[cv2.CascadeClassifier, cv2.CascadeClassifier, cv2.CascadeClassifier]:
    global _face, _face2, _eye
    if _face is None:
        base = cv2.data.haarcascades
        _face = cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml")
        _face2 = cv2.CascadeClassifier(base + "haarcascade_frontalface_alt2.xml")
        _eye = cv2.CascadeClassifier(base + "haarcascade_eye.xml")
    return _face, _face2, _eye


def _load(raw: bytes) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise FixError("Plik nie jest obsługiwanym obrazem (JPG, PNG, WebP).") from exc
    if min(img.size) < 200:
        raise FixError("Zdjęcie jest za małe do automatycznej poprawy (minimum 200 px).")
    scale = WORK_MAX / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    return cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


def _faces(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    f1, f2, _ = _cascades()
    min_side = max(60, min(gray.shape) // 8)
    for c in (f2, f1):
        found = c.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        if len(found):
            return [tuple(int(v) for v in r) for r in found]
    return []


def _eyes(gray: np.ndarray, face: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    """Środki oczu (współrzędne całego obrazu) – szukane w górnej połowie ramki twarzy."""
    _, _, eye = _cascades()
    x, y, w, h = face
    roi = gray[y : y + int(h * 0.6), x : x + w]
    found = eye.detectMultiScale(roi, scaleFactor=1.08, minNeighbors=8, minSize=(w // 8, w // 8))
    centers = [(x + ex + ew / 2, y + ey + eh / 2) for ex, ey, ew, eh in found if ey + eh / 2 < h * 0.5]
    left = [c for c in centers if c[0] < x + w / 2]
    right = [c for c in centers if c[0] >= x + w / 2]
    if not left or not right:
        return []
    return [min(left, key=lambda c: c[1]), min(right, key=lambda c: c[1])]


def _edge_color(img: np.ndarray) -> tuple[int, int, int]:
    """Kolor do dopełnienia kadru: mediana górnego brzegu zdjęcia (zastane tło)."""
    t = max(4, img.shape[0] // 25)
    return tuple(int(v) for v in np.median(img[:t, :].reshape(-1, 3), axis=0))


def _border_stats(img: np.ndarray) -> tuple[float, float]:
    """Średnia jasność i rozrzut koloru na brzegach (góra i boki) – ocena jednolitości tła."""
    h, w = img.shape[:2]
    t = max(4, h // 25)
    strips = [img[:t, :], img[:, :t], img[:, -t:]]
    px = np.concatenate([s.reshape(-1, 3) for s in strips]).astype(np.float32)
    return float(px.mean()), float(px.std(axis=0).mean())


_sess = None
_sess_failed = False


def _session():
    """Sieć do wycinania postaci (U2-Net human seg, ONNX). Brak pliku lub błąd – zwraca None."""
    global _sess, _sess_failed
    if _sess is None and not _sess_failed:
        path = Path(get_settings().photo_seg_model)
        try:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            _sess = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        except Exception:  # noqa: BLE001 – brak modelu nie może zepsuć reszty poprawy
            _sess_failed = True
    return _sess


def _segment(img: np.ndarray) -> np.ndarray | None:
    """Maska osoby 0..1 w rozmiarze zdjęcia albo None, gdy sieć jest niedostępna."""
    sess = _session()
    if sess is None:
        return None
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(cv2.resize(img, (320, 320), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    x = rgb.astype(np.float32) / max(float(rgb.max()), 1.0)
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    pred = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    alpha = cv2.resize(pred, (w, h), interpolation=cv2.INTER_CUBIC)
    alpha = np.clip((alpha - 0.3) / 0.4, 0.0, 1.0)  # wyostrzenie krawędzi
    return cv2.GaussianBlur(alpha, (0, 0), 0.8)


def _crown_y(alpha: np.ndarray, face: tuple[int, int, int, int]) -> int | None:
    """Wysokość czubka głowy (włosów) z maski – nad twarzą, w jej zakresie poziomym."""
    fx, fy, fw, fh = face
    x0, x1 = max(0, int(fx - 0.2 * fw)), min(alpha.shape[1], int(fx + 1.2 * fw))
    rows = np.where(alpha[: fy + fh // 2, x0:x1].max(axis=1) > 0.5)[0]
    return int(rows[0]) if len(rows) else None


def _background_color(img: np.ndarray, alpha: np.ndarray) -> tuple[int, int, int]:
    """Kolor tła z oryginału: mediana pikseli spoza postaci (przy bardzo ciemnym – lekko rozjaśniona)."""
    bgpx = img[alpha < 0.03]
    if len(bgpx) < 500:
        return _edge_color(img)
    med = np.median(bgpx.reshape(-1, 3), axis=0).astype(np.float32)
    lum = float(med.mean())
    if lum < 140:
        med = med + (140 - lum) * (255 - med) / max(float((255 - med).mean()), 1.0)
    return tuple(int(v) for v in np.clip(med, 0, 255))


def _eyes_glasses(gray: np.ndarray, face: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    """Oczy szukane kaskadą „w okularach” – używane, gdy zwykła ich nie znajduje."""
    x, y, w, h = face
    c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml")
    roi = gray[y : y + int(h * 0.6), x : x + w]
    found = c.detectMultiScale(roi, scaleFactor=1.08, minNeighbors=6, minSize=(w // 8, w // 8))
    centers = [(x + ex + ew / 2, y + ey + eh / 2) for ex, ey, ew, eh in found if ey + eh / 2 < h * 0.5]
    left = [c for c in centers if c[0] < x + w / 2]
    right = [c for c in centers if c[0] >= x + w / 2]
    if not left or not right:
        return []
    return [min(left, key=lambda c: c[1]), min(right, key=lambda c: c[1])]


def _transform(cx: float, mid: float, head_h: float, angle: float, ratio: float) -> tuple[np.ndarray, float]:
    scale = OUT_H * ratio / head_h
    m = cv2.getRotationMatrix2D((cx, mid), angle, scale)
    m[0, 2] += OUT_W / 2 - cx
    m[1, 2] += OUT_H * HEAD_CENTER - mid
    return m, scale


def enhance(raw: bytes) -> Result:
    """Zwraca poprawione zdjęcie 600×800 (JPEG) i listę uwag. Rzuca FixError, gdy nie da się go poprawić."""
    img = _load(raw)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    notes: list[Note] = []
    changed: list[str] = []

    faces = _faces(gray)
    if not faces:
        raise FixError(
            "Nie wykryto twarzy. Zrób zdjęcie na wprost, przy dobrym świetle, z całą twarzą w kadrze."
        )
    faces.sort(key=lambda r: r[2] * r[3], reverse=True)
    if len(faces) > 1 and faces[1][2] * faces[1][3] > 0.35 * faces[0][2] * faces[0][3]:
        raise FixError("Na zdjęciu jest więcej niż jedna osoba. Na zdjęciu ma być tylko Twoja twarz.")
    face = faces[0]
    fx, fy, fw, fh = face

    # wyprostowanie głowy wg linii oczu (przy okularach drugą kaskadą)
    eyes = _eyes(gray, face)
    glasses = False
    if len(eyes) != 2:
        eyes = _eyes_glasses(gray, face)
        glasses = len(eyes) == 2
    angle = 0.0
    if len(eyes) == 2:
        (x1, y1), (x2, y2) = eyes
        angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if abs(angle) > 25:
            angle = 0.0
            notes.append(
                Note("warn", "Głowa jest mocno przechylona – zrób zdjęcie, patrząc prosto w obiektyw.")
            )
        elif abs(angle) > 2:
            changed.append("wyprostowano głowę")
        else:
            angle = 0.0
        if glasses:
            notes.append(
                Note(
                    "warn",
                    "Wygląda na to, że masz okulary. Do dowodu najlepiej bez okularów albo bez odblasków na szkłach.",
                )
            )
    else:
        notes.append(
            Note(
                "warn",
                "Nie widać wyraźnie obu oczu (zamknięte, zasłonięte lub odbicia w okularach). Sprawdź zdjęcie.",
            )
        )

    # tło: ujednolicane tylko wtedy, gdy obecne jest nierówne (kolor bierzemy z oryginału)
    _, spread = _border_stats(img)
    want_bg = spread > 14
    alpha = None
    if want_bg:
        alpha = _segment(img)
        if alpha is not None:
            share = float((alpha > 0.5).mean())
            face_cov = float((alpha[fy : fy + fh, fx : fx + fw] > 0.5).mean())
            if not 0.08 < share < 0.85 or face_cov < 0.85:
                alpha = None
        if alpha is None:
            notes.append(
                Note(
                    "warn",
                    "Tło nie jest jednolite, a nie udało się go bezpiecznie zastąpić. Zrób zdjęcie na tle jasnej ściany.",
                )
            )

    # czubek głowy z maski (albo z proporcji), broda z dołu ramki twarzy
    chin = fy + fh * 1.02
    crown = _crown_y(alpha, face) if alpha is not None else None
    head_h = (chin - crown) if crown is not None else fh * (1 + CROWN_ABOVE_BOX)
    if not 1.2 * fh <= head_h <= 1.75 * fh:
        head_h = fh * (1 + CROWN_ABOVE_BOX)
        crown = chin - head_h
    top = chin - head_h
    mid = top + head_h / 2
    cx = fx + fw / 2

    if alpha is not None:
        fill = _background_color(img, alpha)
        a = alpha[..., None]
        bg = np.empty_like(img)
        bg[:] = fill
        img = (img * a + bg * (1 - a)).astype(np.uint8)
        changed.append("ujednolicono tło (kolor z oryginału)")
    else:
        fill = _edge_color(img)

    # głowa 70–80% wysokości: bierzemy największą, przy której kadr nie wychodzi poza zdjęcie
    ones = np.full(img.shape[:2], 255, np.uint8)
    best = None
    for ratio in (0.75, 0.72, 0.70):
        m, scale = _transform(cx, mid, head_h, angle, ratio)
        cover = cv2.warpAffine(ones, m, (OUT_W, OUT_H), flags=cv2.INTER_NEAREST, borderValue=0)
        missing = float((cover == 0).mean())
        if best is None or missing < best[0]:
            best = (missing, m, scale)
        if missing < 0.01:
            break
    missing, m, scale = best
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    out = cv2.warpAffine(
        img, m, (OUT_W, OUT_H), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=fill
    )
    changed.append("kadr 3:4, głowa na środku")
    if fw < 110 or scale > 2.2:
        notes.append(
            Note(
                "warn",
                "Zdjęcie ma niską rozdzielczość – po powiększeniu może być nieostre. Najlepiej zrobić nowe, z bliska.",
            )
        )
    if missing > 0.02:
        notes.append(
            Note(
                "warn",
                "Brakowało miejsca nad głową lub po bokach – dopełniono tło. Lepiej zrobić zdjęcie z większym marginesem.",
            )
        )

    # światło i ostrość oceniane na twarzy w nowym kadrze
    nx0, ny0 = int(OUT_W * 0.5 - fw * scale * 0.4), int(OUT_H * HEAD_CENTER - fh * scale * 0.4)
    roi = out[max(0, ny0) : ny0 + int(fh * scale * 0.8), max(0, nx0) : nx0 + int(fw * scale * 0.8)]
    g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.size else cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    if float(cv2.Laplacian(g, cv2.CV_64F).var()) < 40:
        notes.append(
            Note("warn", "Zdjęcie jest nieostre lub poruszone. Zrób nowe, trzymając telefon nieruchomo.")
        )
    lum = float(g.mean())
    if lum < 105 or lum > 190:
        gamma = float(np.clip(np.log(150 / 255) / np.log(max(lum, 1) / 255), 0.6, 1.7))
        table = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], np.uint8)
        out = cv2.LUT(out, table)
        changed.append("wyrównano jasność")
        if lum < 70 or lum > 215:
            notes.append(
                Note(
                    "warn",
                    "Twarz jest bardzo ciemna lub prześwietlona – lepiej zrobić zdjęcie przy dobrym, równym świetle.",
                )
            )

    if not want_bg:
        notes.append(Note("ok", "Tło jest jednolite."))
    notes.append(Note("ok", "Wykryto jedną twarz, kadr zgodny z zasadami zdjęcia do dowodu."))
    notes.append(
        Note(
            "warn",
            "Sprawdź sam(a): neutralny wyraz twarzy, oczy otwarte, bez okularów z odblaskami i bez nakrycia głowy.",
        )
    )
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise FixError("Nie udało się przetworzyć zdjęcia.")
    return Result(jpeg=buf.tobytes(), notes=notes, changed=changed)
