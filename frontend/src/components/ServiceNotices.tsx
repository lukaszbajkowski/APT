import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Loader, Text } from "@mantine/core";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCalendarTime,
  IconInfoCircle,
  IconRocket,
  IconTool,
  IconX,
  type Icon,
} from "@tabler/icons-react";

import { api, probeServer, serverDownStore, setServerDown } from "../api";
import { useAuth } from "../auth";
import { deviceTz, differsFromHome, HOME_TZ, timeIn } from "../lib/time";

// Godziny przerwy zawsze w strefie urządzenia, na którym ktoś patrzy (odczyt przy każdym wyświetleniu –
// po zmianie strefy w telefonie, np. w podróży, pasek od razu pokazuje właściwą godzinę).
import { useT } from "../lib/i18n";

export type NoticeKind = "planned" | "deploy" | "repair" | "incident" | "info";
export interface ServiceNotice {
  id: number;
  kind: NoticeKind;
  title: string;
  body: string;
  starts_at: string | null;
  ends_at: string | null;
  blocking: boolean;
  published: boolean;
  ongoing: boolean;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export const NOTICE_KINDS: Record<NoticeKind, { label: string; icon: Icon; tone: string }> = {
  planned: { label: "Planowane prace", icon: IconCalendarTime, tone: "blue" },
  deploy: { label: "Wdrożenie nowej funkcji", icon: IconRocket, tone: "teal" },
  repair: { label: "Prace naprawcze", icon: IconTool, tone: "orange" },
  incident: { label: "Awaria", icon: IconAlertTriangle, tone: "red" },
  info: { label: "Informacja", icon: IconInfoCircle, tone: "gray" },
};

const CACHE = "apt-service-notices";
const DISMISSED = "apt-service-notices-hidden";
const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null") ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* tryb prywatny – trudno */
  }
};

/** Czy komunikat trwa teraz (liczone w przeglądarce, żeby przerwa włączyła się i skończyła o czasie). */
export function isOngoing(n: ServiceNotice, now = Date.now()): boolean {
  return (!n.starts_at || new Date(n.starts_at).getTime() <= now) && (!n.ends_at || new Date(n.ends_at).getTime() > now);
}
const isOver = (n: ServiceNotice, now = Date.now()) => !!n.ends_at && new Date(n.ends_at).getTime() <= now;

/** Dzień w strefie użytkownika jako liczba (do porównań „dziś / jutro”). */
const dayNum = (x: Date) => {
  const [y, m, d] = x.toLocaleDateString("en-CA", { timeZone: deviceTz() }).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** „dziś, 22:00” / „jutro, 6:00” / „sob. 8.11, 22:00” – w strefie użytkownika */
export function dayTime(at: string): string {
  const d = new Date(at);
  const diff = dayNum(d) - dayNum(new Date());
  const time = timeIn(d, deviceTz());
  if (diff === 0) return `dziś, ${time}`;
  if (diff === 1) return `jutro, ${time}`;
  if (diff === -1) return `wczoraj, ${time}`;
  const tz = deviceTz();
  const wd = d.toLocaleDateString("pl-PL", { weekday: "short", timeZone: tz });
  const dm = d.toLocaleDateString("pl-PL", { day: "numeric", month: "2-digit", timeZone: tz });
  return `${wd} ${dm}, ${time}`;
}
const sameDay = (a: string, b: string) => dayNum(new Date(a)) === dayNum(new Date(b));

/** Poza strefą polską: godziny przerwy także w czasie polskim („22:00–23:30 czasu polskiego”). */
function homeHint(n: ServiceNotice): string {
  const at = n.starts_at ?? n.ends_at;
  if (!at || !differsFromHome(new Date(at), deviceTz())) return "";
  const parts = [n.starts_at, n.ends_at].filter(Boolean).map((x) => timeIn(new Date(x as string), HOME_TZ));
  return ` (${parts.join("–")} czasu polskiego)`;
}

/** Opis czasu komunikatu: „Trwa · do dziś, 23:00”, „sob. 8.11, 22:00–23:30”, „Od jutra, 6:00”. */
export function whenText(n: ServiceNotice, now = Date.now()): string {
  if (isOver(n, now)) return n.ends_at ? `Zakończone ${dayTime(n.ends_at)}` : "Zakończone";
  if (isOngoing(n, now)) return n.ends_at ? `Trwa · do ${dayTime(n.ends_at)}${homeHint({ ...n, starts_at: null })}` : "Trwa";
  if (n.starts_at && n.ends_at)
    return (
      (sameDay(n.starts_at, n.ends_at)
        ? `${dayTime(n.starts_at)}–${timeIn(new Date(n.ends_at), deviceTz())}`
        : `${dayTime(n.starts_at)} – ${dayTime(n.ends_at)}`) + homeHint(n)
    );
  return n.starts_at ? `Od ${dayTime(n.starts_at)}${homeHint(n)}` : "";
}

/** Zegar odświeżający widok co 30 s – przerwa zaczyna się i kończy bez przeładowania strony. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Aktywne komunikaty techniczne – tylko dla zalogowanych (przed logowaniem nic nie widać). Ostatnia znana lista
 * zostaje w przeglądarce na wypadek, gdy serwer nie odpowiada; po wylogowaniu jest czyszczona.
 */
export function useServiceNotices() {
  const { me } = useAuth();
  const signedIn = !!me && !me.mfa_pending;
  useEffect(() => {
    if (!signedIn) {
      try {
        localStorage.removeItem(CACHE);
      } catch {
        /* trudno */
      }
    }
  }, [signedIn]);
  return useQuery({
    queryKey: ["service-notices-current", me?.user.id ?? null],
    enabled: signedIn,
    queryFn: async () => {
      const list = await api<ServiceNotice[]>("/service-notices/current");
      write(CACHE, list);
      return list;
    },
    placeholderData: () => (signedIn ? read<ServiceNotice[]>(CACHE, []) : []),
    // co 30 s: zalogowani zobaczą przerwę (i jej koniec) bez odświeżania strony; nie przedłuża to sesji
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

function isAdmin(me: ReturnType<typeof useAuth>["me"]) {
  return !!me && (me.real_role ?? me.user.role) === "admin";
}

/** Pasek komunikatów technicznych nad treścią aplikacji (po zalogowaniu). */
export function ServiceNoticeBanner() {
  const t = useT();
  const { me } = useAuth();
  const q = useServiceNotices();
  const now = useNow();
  const [hidden, setHidden] = useState<string[]>(() => read<string[]>(DISMISSED, []));
  const admin = isAdmin(me);
  const { pathname } = useLocation();
  // na ekranie zarządzania komunikatami lista jest niżej – pasek by ją dublował
  if (pathname.startsWith("/komunikaty-techniczne")) return null;
  const list = (me ? q.data ?? [] : []).filter((n) => !isOver(n, now) && !hidden.includes(`${n.id}:${n.updated_at}`));
  if (list.length === 0) return null;
  const hide = (n: ServiceNotice) => {
    const next = [...hidden, `${n.id}:${n.updated_at}`].slice(-30);
    setHidden(next);
    write(DISMISSED, next);
  };
  return (
    <div className="ui-svc-list" role="region" aria-label={t("Komunikaty techniczne")}>
      {list.map((n) => {
        const k = NOTICE_KINDS[n.kind];
        const ongoing = isOngoing(n, now);
        // trwająca awaria, prace naprawcze i przerwa – bez zamykania, dopóki trwają
        const sticky = ongoing && (n.blocking || n.kind === "incident" || n.kind === "repair");
        const Icon = k.icon;
        return (
          <div key={n.id} className="ui-svc" data-tone={k.tone} role={ongoing ? "alert" : "status"}>
            <span className="ui-svc-icon" aria-hidden>
              <Icon size={20} />
            </span>
            <div className="ui-svc-text">
              <span className="ui-svc-meta">
                {t(k.label)}
                {whenText(n, now) ? ` · ${t(whenText(n, now))}` : ""}
              </span>
              <span className="ui-svc-title">{t(n.title)}</span>
              {n.body && <span className="ui-svc-body">{t(n.body)}</span>}
              {admin && ongoing && n.blocking && (
                <span className="ui-svc-admin">
                  Przerwa trwa – pozostali użytkownicy widzą ekran przerwy technicznej. Ty jako administrator masz dostęp.{" "}
                  <Link to="/komunikaty-techniczne">Zarządzaj</Link>
                </span>
              )}
            </div>
            {!sticky && (
              <button type="button" className="ui-svc-close" aria-label={t("Ukryj komunikat")} onClick={() => hide(n)}>
                <IconX size={18} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Ekran na całą stronę: przerwa techniczna (zaplanowana) albo serwer chwilowo niedostępny. */
function OutageScreen({
  down,
  notice,
  onRetry,
  checking,
}: {
  down: boolean;
  notice: ServiceNotice | null;
  onRetry: () => void;
  checking: boolean;
}) {
  const t = useT();
  const kind = notice ? NOTICE_KINDS[notice.kind] : NOTICE_KINDS.repair;
  const Icon = down && !notice ? IconTool : kind.icon;
  const title = notice ? (notice.kind === "incident" ? "Awaria" : "Przerwa techniczna") : "Serwis chwilowo niedostępny";
  const lead = notice
    ? notice.title
    : "Trwają prace techniczne albo wystąpił problem z serwerem. Pracujemy nad tym – aplikacja wróci automatycznie.";
  useEffect(() => {
    const prev = document.title;
    document.title = `${t(title)} – APT iD`;
    return () => {
      document.title = prev;
    };
  }, [title, t]);
  return (
    <main className="ui-outage" data-tone={notice ? kind.tone : "orange"}>
      <div className="ui-outage-card">
        <span className="ui-outage-icon" aria-hidden>
          <Icon size={34} />
        </span>
        <h1 className="ui-outage-title">{t(title)}</h1>
        <p className="ui-outage-lead">{t(lead)}</p>
        {notice?.body && <p className="ui-outage-body">{t(notice.body)}</p>}
        {notice?.ends_at && (
          <div className="ui-outage-when">
            <span>{t("Planowany koniec")}</span>
            <strong>{t(dayTime(notice.ends_at))}</strong>
          </div>
        )}
        <p className="ui-outage-safe">{t("Twoje dane są bezpieczne. Nic nie musisz robić – strona sama sprawdza, czy działa.")}</p>
        <Button size="md" fullWidth variant="light" onClick={onRetry} loading={checking}>
          {t("Sprawdź teraz")}
        </Button>
        <Text size="xs" c="dimmed" ta="center" mt={4} className="ui-outage-auto">
          {checking ? <Loader size={10} mr={6} /> : null}
          {t(down ? "Sprawdzamy co 15 sekund" : "Sprawdzamy co 30 sekund")}
        </Text>
      </div>
      <p className="ui-outage-brand">APT iD · aptid.pl</p>
    </main>
  );
}

/**
 * Bramka całej aplikacji: gdy serwer nie odpowiada – ekran „Serwis chwilowo niedostępny” (z ostatnim znanym
 * komunikatem, tylko po zalogowaniu); gdy trwa przerwa blokująca – po zalogowaniu ekran „Przerwa techniczna”
 * dla wszystkich poza administratorem. Przed zalogowaniem komunikatów nie widać, logowanie działa normalnie.
 */
export function ServiceGate({ children }: { children: ReactNode }) {
  const down = useSyncExternalStore(serverDownStore.subscribe, serverDownStore.get);
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useServiceNotices();
  const now = useNow(down ? 15_000 : 30_000);
  const [checking, setChecking] = useState(false);
  const admin = isAdmin(me);
  const navigate = useNavigate();
  const t = useT();

  const check = async () => {
    setChecking(true);
    const ok = await probeServer();
    setChecking(false);
    if (ok) {
      setServerDown(false);
      // po powrocie serwera odświeżamy wszystko, co nie dało się wczytać
      await qc.invalidateQueries();
    } else {
      q.refetch().catch(() => undefined);
    }
  };
  // automatyczne sprawdzanie, dopóki serwer nie wróci / przerwa trwa
  useEffect(() => {
    if (!down) return;
    const id = window.setInterval(check, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [down]);

  const list = me ? q.data ?? [] : [];
  const blocking = list.find((n) => n.blocking && isOngoing(n, now)) ?? null;
  const blocked = !!blocking && !admin;
  // koniec przerwy: kto był nią zablokowany (i nie został w tym czasie wylogowany za bezczynność),
  // wraca na ekran główny z odświeżonymi danymi
  const wasBlocked = useRef(false);
  useEffect(() => {
    if (blocked) {
      wasBlocked.current = true;
      return;
    }
    if (!wasBlocked.current) return;
    wasBlocked.current = false;
    if (!me) return;
    navigate("/", { replace: true });
    qc.invalidateQueries();
    notifications.show({ color: "teal", title: t("Przerwa techniczna zakończona"), message: t("Aplikacja znów działa normalnie.") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, me]);
  if (down) {
    // ostatni znany komunikat, który trwa (najpierw przerwa blokująca)
    const known = blocking ?? list.find((n) => n.kind !== "info" && isOngoing(n, now)) ?? null;
    return <OutageScreen down notice={known} onRetry={check} checking={checking} />;
  }
  if (blocked && blocking) {
    return <OutageScreen down={false} notice={blocking} onRetry={() => q.refetch()} checking={q.isFetching} />;
  }
  return <>{children}</>;
}
