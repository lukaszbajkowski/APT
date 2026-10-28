# ruff: noqa: E501  (długie komunikaty po polsku)
"""Automatyczna poprawa zdjęcia do karty (wg zasad zdjęcia do dowodu): twarz, prosta głowa, kadr, tło, światło.

Wszystko działa na serwerze, bez zewnętrznych usług i bez pobierania modeli: wykrywanie twarzy i oczu
(kaskady Haara z OpenCV), wyprostowanie, kadr 3:4 z głową zajmującą ok. 75% wysokości, jednolite jasne tło
(GrabCut, tylko gdy obecne tło jest nierówne) i delikatne wyrównanie jasności. Zdjęcia, których nie da się
bezpiecznie poprawić (brak twarzy, kilka osób), są odrzucane z komunikatem. Wynik zawsze zatwierdza człowiek.
"""

import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

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
    """Kolor do dopełnienia kadru: mediana górnego brzegu zdjęcia, gdy jest jasny, inaczej jasna szarość."""
    t = max(4, img.shape[0] // 25)
    med = np.median(img[:t, :].reshape(-1, 3), axis=0)
    return tuple(int(v) for v in med) if float(med.mean()) > 170 else BG_COLOR[::-1]


def _border_stats(img: np.ndarray) -> tuple[float, float]:
    """Średnia jasność i rozrzut koloru na brzegach (góra i boki) – ocena jednolitości tła."""
    h, w = img.shape[:2]
    t = max(4, h // 25)
    strips = [img[:t, :], img[:, :t], img[:, -t:]]
    px = np.concatenate([s.reshape(-1, 3) for s in strips]).astype(np.float32)
    return float(px.mean()), float(px.std(axis=0).mean())


def _replace_background(img: np.ndarray, face: tuple[int, int, int, int]) -> np.ndarray | None:
    h, w = img.shape[:2]
    sw, sh = 300, 400
    small = cv2.resize(img, (sw, sh), interpolation=cv2.INTER_AREA)
    fx, fy, fw, fh = (int(v * sw / w) if i % 2 == 0 else int(v * sh / h) for i, v in enumerate(face))
    mask = np.full((sh, sw), cv2.GC_PR_BGD, np.uint8)
    b = max(3, sw // 40)
    mask[:b, :] = mask[:, :b] = mask[:, -b:] = cv2.GC_BGD
    # głowa i ramiona: prawdopodobny pierwszy plan; środek twarzy: pewny
    cv2.ellipse(
        mask, (fx + fw // 2, fy + fh // 2), (int(fw * 0.85), int(fh * 1.05)), 0, 0, 360, cv2.GC_PR_FGD, -1
    )
    body_top = fy + fh
    cv2.rectangle(mask, (max(0, fx - fw // 2), body_top), (min(sw, fx + fw + fw // 2), sh), cv2.GC_PR_FGD, -1)
    cv2.ellipse(
        mask, (fx + fw // 2, fy + fh // 2), (int(fw * 0.35), int(fh * 0.45)), 0, 0, 360, cv2.GC_FGD, -1
    )
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(small, mask, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        return None
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    share = float((fg > 0).mean())
    if not 0.2 < share < 0.8:
        return None
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    alpha = cv2.GaussianBlur(cv2.resize(fg, (w, h), interpolation=cv2.INTER_LINEAR), (0, 0), 2.0)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    bg = np.empty_like(img)
    bg[:] = BG_COLOR[::-1]
    return (img * a + bg * (1 - a)).astype(np.uint8)


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

    # wyprostowanie głowy wg linii oczu
    eyes = _eyes(gray, face)
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
    else:
        notes.append(
            Note(
                "warn",
                "Nie widać wyraźnie obu oczu (zamknięte, zasłonięte lub odbicia w okularach). Sprawdź zdjęcie.",
            )
        )

    fx, fy, fw, fh = face
    cx = fx + fw / 2
    head_h = fh * (1 + CROWN_ABOVE_BOX)
    scale = OUT_H * HEAD_RATIO / head_h
    head_mid = fy - fh * CROWN_ABOVE_BOX + head_h / 2
    # jedno przekształcenie: obrót wokół twarzy + skala + przesunięcie na środek kadru (brzeg: kolor tła)
    m = cv2.getRotationMatrix2D((cx, head_mid), angle, scale)
    m[0, 2] += OUT_W / 2 - cx
    m[1, 2] += OUT_H * HEAD_CENTER - head_mid
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    fill = _edge_color(img)
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
    # za ciasny kadr: część wyniku pochodzi z powielonych brzegów
    ones = np.full(img.shape[:2], 255, np.uint8)
    cover = cv2.warpAffine(ones, m, (OUT_W, OUT_H), flags=cv2.INTER_NEAREST, borderValue=0)
    if float((cover == 0).mean()) > 0.02:
        notes.append(
            Note(
                "warn",
                "Brakowało miejsca nad głową lub po bokach – dopełniono tło. Lepiej zrobić zdjęcie z większym marginesem.",
            )
        )

    # twarz w nowym kadrze: obszar do oceny światła i ostrości
    nx0, ny0 = int(OUT_W * 0.5 - fw * scale * 0.4), int(OUT_H * HEAD_CENTER - fh * scale * 0.4)
    roi = out[max(0, ny0) : ny0 + int(fh * scale * 0.8), max(0, nx0) : nx0 + int(fw * scale * 0.8)]
    g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.size else cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    sharp = float(cv2.Laplacian(g, cv2.CV_64F).var())
    if sharp < 40:
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

    # tło: wymieniane tylko wtedy, gdy obecne nie jest jednolite i jasne
    mean, spread = _border_stats(out)
    if spread > 22 or mean < 150:
        replaced = _replace_background(
            out,
            (
                int(OUT_W / 2 - fw * scale / 2),
                int(OUT_H * HEAD_CENTER - head_h * scale / 2 + CROWN_ABOVE_BOX * fh * scale),
                int(fw * scale),
                int(fh * scale),
            ),
        )
        if replaced is None:
            notes.append(
                Note(
                    "warn",
                    "Tło nie jest jednolite, a nie udało się go bezpiecznie zastąpić. Zrób zdjęcie na tle jasnej ściany.",
                )
            )
        else:
            out = replaced
            changed.append("zastąpiono tło jednolitym jasnym")
    else:
        notes.append(Note("ok", "Tło jest jednolite i jasne."))

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
