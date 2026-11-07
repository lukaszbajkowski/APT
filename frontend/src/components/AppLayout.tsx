import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { LanguagePicker, useLang, useT } from "../lib/i18n";
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  AppShell,
  Avatar,
  Badge,
  Box,
  Drawer,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
  useMantineColorScheme,
  type MantineColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBook,
  IconChartBar,
  IconCertificate2,
  IconChecklist,
  IconChevronDown,
  IconChevronLeft,
  IconHelpCircle,
  IconX,
  IconChevronRight,
  IconClipboardCheck,
  IconClockShield,
  IconDeviceDesktop,
  IconFileSpreadsheet,
  IconFileText,
  IconFingerprint,
  IconHeartbeat,
  IconTool,
  IconHome,
  IconKey,
  IconListDetails,
  IconLogout,
  IconMenu2,
  IconMessage,
  IconMoon,
  IconScan,
  IconSchool,
  IconSelector,
  IconShieldCheck,
  IconShieldLock,
  IconSignature,
  IconSpeakerphone,
  IconSun,
  IconSwitchHorizontal,
  IconTargetArrow,
  IconUserCircle,
  IconUserCog,
  IconUserPlus,
  IconUsersGroup,
  IconLanguage,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../auth";
import { ScreenErrorBoundary } from "./ErrorBoundary";
import { SimulationBanner, SimulationMenu } from "./Simulation";
import { NetworkBanner } from "./States";
import { ServiceNoticeBanner } from "./ServiceNotices";
import { api, MFA_PATH, ROLE_LABELS } from "../api";
import { useResponsiveTables } from "../lib/responsiveTables";
import { useDocTitle } from "../lib/docTitle";
import { MobileHeaderProvider, useMobileHeaderValue, useNavHeightVar } from "./Mobile";

type NavItem = { to: string; label: string; icon: typeof IconHome; show: boolean; badge?: number; group?: string; /** krótsza etykieta w dolnym menu telefonu */ tab?: string };

const ADMIN_GROUP = "Administracja";

function isActivePath(to: string, path: string) {
  return to === "/" || to === "/moje-konto" ? path === to : path === to || path.startsWith(to + "/");
}

const ROUTE_TITLES: Record<string, string> = {
  "/": "Dziś",
  "/pracownicy": "Pracownicy",
  "/pracownicy/nowy": "Nowy pracownik",
  "/pracownicy/import": "Import z arkusza",
  "/skaner": "Skaner kart",
  "/do-zrobienia": "Do zrobienia",
  "/wiadomosci": "Wiadomości",
  "/komunikaty": "Komunikaty",
  "/zadania": "Zadania",
  "/szkolenia": "Szkolenia",
  "/szkolenia/import": "Import szkoleń",
  "/dokumenty-pobytowe": "Dokumenty pobytowe",
  "/braki": "Braki w danych",
  "/zgloszenia": "Zgłoszenia",
  "/zestawienia": "Zestawienia",
  "/raporty": "Raporty",
  "/konta-pracownikow": "Konta pracowników",
  "/slowniki": "Słowniki",
  "/szablony": "Szablony",
  "/uzytkownicy": "Użytkownicy",
  "/uzytkownicy/wylaczeni": "Wyłączeni użytkownicy",
  "/przeglad-dostepu": "Przegląd dostępu",
  "/retencja": "Retencja danych",
  "/stan-systemu": "Stan systemu",
  "/komunikaty-techniczne": "Komunikaty techniczne",
  "/tlumaczenia": "Tłumaczenia",
  "/dziennik": "Dziennik zdarzeń",
  "/wzornik": "Wzornik",
  "/moje-konto": "Moje konto",
  "/moje-konto/do-podpisu": "Do podpisu",
  "/moje-konto/komunikaty": "Komunikaty",
  "/moje-konto/wiadomosci": "Wiadomości",
  "/moje-konto/klucze": "Logowanie i powiadomienia",
  "/moje-konto/dane": "Moje dane",
};
// ekrany „pierwszego poziomu”: bez strzałki powrotu
const TOP_LEVEL = new Set(["/moje-konto", "/moje-konto/do-podpisu", "/moje-konto/komunikaty", "/moje-konto/wiadomosci", "/moje-konto/klucze"]);

function headerFor(path: string): { title: string; back?: string } {
  const clean = path.replace(/\/+$/, "") || "/";
  const parts = clean.split("/").filter(Boolean);
  const top = parts.length <= 1 || TOP_LEVEL.has(clean);
  const parent = "/" + parts.slice(0, -1).join("/");
  let title = ROUTE_TITLES[clean];
  if (!title) {
    if (/^\/pracownicy\/\d+\/edycja$/.test(clean)) title = "Edycja danych";
    else if (/^\/pracownicy\/\d+$/.test(clean)) title = "Pracownik";
    else title = ROUTE_TITLES[parent] ?? "";
  }
  return { title, back: top ? undefined : parent };
}

/** Tytuł karty przeglądarki z nazwy ekranu (albo własnego tytułu ekranu, np. „Komunikat”). */
function DocTitle() {
  const location = useLocation();
  const own = useMobileHeaderValue();
  const t = useT();
  const { hasRole } = useAuth();
  const auto = headerFor(location.pathname);
  if (location.pathname === "/moje-konto") auto.title = hasRole("employee") ? "Moje konto" : "Logowanie i powiadomienia";
  useDocTitle(t(own.title ?? auto.title) || null);
  return null;
}

/** Pasek górny telefonu: powrót, nazwa ekranu, konto. Na ekranach głównych nazwa pojawia się po przewinięciu (duży tytuł jest w treści). */
function MobileTopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const own = useMobileHeaderValue();
  const t = useT();
  const { hasRole: role } = useAuth();
  const auto = headerFor(location.pathname);
  if (location.pathname === "/moje-konto" && !role("employee")) auto.title = "Logowanie i powiadomienia";
  const back = own.onBack ? "#" : own.back ?? auto.back;
  const [scrolled, setScrolled] = useState(false);
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    const on = () => {
      setScrolled(window.scrollY > 48);
      setDeep(window.scrollY > 110);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [location.pathname]);
  const swap = deep && !!own.scrolledTitle;
  const title = swap ? own.scrolledTitle! : own.title ?? auto.title;
  const subtitle = swap ? own.scrolledSubtitle : own.subtitle;
  const showTitle = !!back || !!own.title || scrolled;
  return (
    <div className="topbar">
      {own.close ? (
        <span className="topbar-btn" aria-hidden />
      ) : back ? (
        <UnstyledButton
          className="topbar-btn"
          aria-label="Wróć"
          onClick={() => (own.onBack ? own.onBack() : navigate(back))}
        >
          <IconChevronLeft size={26} stroke={2.2} />
        </UnstyledButton>
      ) : (
        <span className="topbar-btn" aria-hidden />
      )}
      <div className="topbar-title" data-visible={showTitle || undefined} aria-hidden={!showTitle} key={swap ? "deep" : "top"}>
        <span className="topbar-title-main">{title}</span>
        {subtitle && <span className="topbar-title-sub">{subtitle}</span>}
      </div>
      {own.close ? (
        <UnstyledButton className="topbar-btn" aria-label={t("Zamknij")} onClick={() => own.onBack?.()}>
          <IconX size={26} stroke={2.2} />
        </UnstyledButton>
      ) : (
        <AccountMenu compact />
      )}
    </div>
  );
}

export function AppLayout() {
  return (
    <MobileHeaderProvider>
      <DocTitle />
      <AppLayoutInner />
    </MobileHeaderProvider>
  );
}

function AppLayoutInner() {
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  // wysokość dolnego menu (z paskiem iPhone'a) jako --apt-nav-h – formularze i toasty ustawiają się tuż nad nim
  useNavHeightVar(mobile);
  const [moreOpen, setMoreOpen] = useState(false);
  useResponsiveTables();
  const { hasRole } = useAuth();
  const location = useLocation();
  // nowy ekran zaczyna się od góry; „Wstecz” (POP) zostawia pozycję, którą przywraca przeglądarka
  const navType = useNavigationType();
  useLayoutEffect(() => {
    if (navType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navType]);
  const t = useT();
  const lang = useLang();
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("apt-nav-collapsed-v2") ?? JSON.stringify([ADMIN_GROUP])) as string[];
    } catch {
      return [ADMIN_GROUP];
    }
  });
  const toggleGroup = (g: string) =>
    setCollapsed((c) => {
      const next = c.includes(g) ? c.filter((x) => x !== g) : [...c, g];
      try {
        localStorage.setItem("apt-nav-collapsed-v2", JSON.stringify(next));
      } catch {
        /* pamięć przeglądarki niedostępna – zwijanie działa do odświeżenia */
      }
      return next;
    });

  const count = useQuery({
    queryKey: ["hr-count"],
    queryFn: () => api<{ new: number; unread: number }>("/hr-messages/count"),
    enabled: hasRole("admin", "hr"),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });
  const myCount = useQuery({
    queryKey: ["my-msg-count"],
    queryFn: () => api<{ unread: number }>("/me/messages/count"),
    enabled: hasRole("employee"),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });
  const bcCount = useQuery({
    queryKey: ["my-bc-count"],
    queryFn: () => api<{ unread: number }>("/me/broadcasts/count"),
    enabled: hasRole("employee"),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const sigCount = useQuery({
    queryKey: ["my-sig-count"],
    queryFn: () => api<{ pending: number }>("/me/signatures/count"),
    enabled: hasRole("employee"),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  const staff = hasRole("admin", "hr");
  const canScan = !hasRole("agency", "employee");
  const items: NavItem[] = [
    // pracownik
    { to: "/moje-konto", label: "Moje konto", icon: IconHome, show: hasRole("employee") },
    { to: "/moje-konto/do-podpisu", label: "Do podpisu", icon: IconSignature, show: hasRole("employee"), badge: sigCount.data?.pending ?? 0 },
    { to: "/moje-konto/komunikaty", label: "Komunikaty", icon: IconSpeakerphone, show: hasRole("employee"), badge: bcCount.data?.unread ?? 0, group: "Komunikacja" },
    { to: "/moje-konto/wiadomosci", label: "Napisz do kadr", tab: "Wiadomości", icon: IconMessage, show: hasRole("employee"), badge: myCount.data?.unread ?? 0, group: "Komunikacja" },
    { to: "/moje-konto/klucze", label: "Logowanie i powiadomienia", icon: IconFingerprint, show: hasRole("employee"), group: "Ustawienia" },
    // personel
    { to: "/", label: "Dziś", icon: IconHome, show: !hasRole("employee") },
    { to: "/pracownicy", label: "Pracownicy", icon: IconUsersGroup, show: !hasRole("employee") },
    { to: "/skaner", label: "Skaner kart", icon: IconScan, show: canScan },
    { to: "/do-zrobienia", label: "Do zrobienia", icon: IconTargetArrow, show: staff },

    { to: "/wiadomosci", label: "Wiadomości", icon: IconMessage, show: staff, badge: count.data?.unread ?? 0, group: "Komunikacja" },
    { to: "/komunikaty", label: "Komunikaty", icon: IconSpeakerphone, show: staff, group: "Komunikacja" },

    { to: "/zadania", label: "Zadania", icon: IconChecklist, show: hasRole("admin", "hr", "manager"), group: "Kadry" },
    { to: "/szkolenia", label: "Szkolenia", icon: IconSchool, show: hasRole("admin", "hr", "manager"), group: "Kadry" },
    { to: "/dokumenty-pobytowe", label: "Dokumenty pobytowe", icon: IconCertificate2, show: staff, group: "Kadry" },
    { to: "/braki", label: "Braki w danych", icon: IconClipboardCheck, show: hasRole("admin", "hr", "manager"), group: "Kadry" },
    { to: "/zgloszenia", label: "Zgłoszenia nowych osób", icon: IconUserPlus, show: hasRole("admin", "hr", "agency"), group: "Kadry" },
    { to: "/zestawienia", label: "Zestawienia dla agencji", icon: IconFileSpreadsheet, show: hasRole("admin", "hr", "agency"), group: "Kadry" },
    { to: "/raporty", label: "Raporty", icon: IconChartBar, show: hasRole("admin", "hr", "manager"), group: "Kadry" },

    { to: "/konta-pracownikow", label: "Konta pracowników", icon: IconUserCircle, show: staff, group: ADMIN_GROUP },
    { to: "/slowniki", label: "Słowniki", icon: IconBook, show: staff, group: ADMIN_GROUP },
    { to: "/szablony", label: "Szablony dokumentów", icon: IconFileText, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/uzytkownicy", label: "Użytkownicy", icon: IconUserCog, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/przeglad-dostepu", label: "Przegląd dostępu", icon: IconShieldCheck, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/retencja", label: "Retencja danych", icon: IconClockShield, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/stan-systemu", label: "Stan systemu", icon: IconHeartbeat, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/komunikaty-techniczne", label: "Komunikaty techniczne", icon: IconTool, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/tlumaczenia", label: "Tłumaczenia", icon: IconLanguage, show: hasRole("admin"), group: ADMIN_GROUP },
    { to: "/dziennik", label: "Dziennik zdarzeń", icon: IconListDetails, show: hasRole("admin"), group: ADMIN_GROUP },
  ].filter((i) => i.show);

  // dolny pasek na telefonie: najczęstsze miejsca + skaner na środku
  const byPath = (p: string) => items.find((i) => i.to === p);
  const tabPaths = hasRole("employee")
    ? ["/moje-konto", "/moje-konto/do-podpisu", "/moje-konto/komunikaty", "/moje-konto/wiadomosci"]
    : hasRole("agency")
      ? ["/", "/pracownicy", "/zgloszenia", "/zestawienia"]
      : staff
        ? ["/", "/pracownicy", "/wiadomosci"]
        : ["/", "/pracownicy"];
  const tabs = tabPaths.map(byPath).filter((x): x is NavItem => !!x);
  const moreBadge = items.filter((i) => !tabPaths.includes(i.to)).reduce((n, i) => n + (i.badge ?? 0), 0);

  const navList = (onNavigate?: () => void) => (
    <NavList items={items} path={location.pathname} collapsed={collapsed} toggleGroup={toggleGroup} onNavigate={onNavigate} />
  );

  return (
    <AppShell
      header={{ height: 52, collapsed: !mobile }}
      footer={{ height: 58, collapsed: !mobile }}
      navbar={{ width: 256, breakpoint: "sm", collapsed: { mobile: true } }}
      padding={mobile ? "sm" : "lg"}
    >
      {mobile && (
        <AppShell.Header>
          <MobileTopBar />
        </AppShell.Header>
      )}

      <AppShell.Navbar p="sm">
        <AppShell.Section>
          <Link to={hasRole("employee") ? "/moje-konto" : "/"} className="brand-link">
            <Group gap={10} wrap="nowrap" px={6} pt={4} pb="md">
              <BrandMark />
              <Box style={{ lineHeight: 1.2, minWidth: 0 }}>
                <Text fw={750} size="sm" className="brand-title">
                  Identyfikacja
                </Text>
                <Text size="xs" c="dimmed">
                  pracowników APT
                </Text>
              </Box>
            </Group>
          </Link>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} type="auto" scrollbarSize={8}>
          {navList()}
        </AppShell.Section>
        <AppShell.Section pt="xs" style={{ borderTop: "1px solid var(--apt-line)" }}>
          <AccountMenu />
        </AppShell.Section>
      </AppShell.Navbar>

      {mobile && (
        <AppShell.Footer>
          <nav aria-label={t("Menu główne")} className="tabbar">
            {tabs.slice(0, 2).map((i) => (
              <TabLink key={i.to} item={i} active={isActivePath(i.to, location.pathname)} label={t(i.tab ?? i.label)} />
            ))}
            {canScan ? (
              <Link to="/skaner" className="tabbar-item tabbar-scan" aria-current={location.pathname === "/skaner" ? "page" : undefined} data-active={location.pathname === "/skaner" || undefined}>
                <span className="tabbar-icon">
                  <IconScan size={22} stroke={2} />
                </span>
                <span className="tabbar-label">{t("Skanuj")}</span>
              </Link>
            ) : (
              tabs[2] && <TabLink item={tabs[2]} active={isActivePath(tabs[2].to, location.pathname)} label={t(tabs[2].tab ?? tabs[2].label)} />
            )}
            {tabs.slice(canScan ? 2 : 3, canScan ? 3 : 4).map((i) => (
              <TabLink key={i.to} item={i} active={isActivePath(i.to, location.pathname)} label={t(i.tab ?? i.label)} />
            ))}
            <UnstyledButton className="tabbar-item" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" data-active={moreOpen || undefined}>
              <span className="tabbar-icon">
                <IconMenu2 size={22} stroke={1.9} />
                {moreBadge > 0 && <span className="tabbar-badge">{moreBadge}</span>}
              </span>
              <span className="tabbar-label">{t("Więcej")}</span>
            </UnstyledButton>
          </nav>
        </AppShell.Footer>
      )}

      <Drawer
        opened={moreOpen}
        onClose={() => setMoreOpen(false)}
        position="bottom"
        size="85%"
        title={t("Wszystkie sekcje")}
        radius="lg"
        styles={{ body: { paddingBottom: 24 } }}
      >
        {navList(() => setMoreOpen(false))}
      </Drawer>

      <AppShell.Main>
        <SimulationBanner />
        <ServiceNoticeBanner />
        <NetworkBanner />
        {lang && lang !== "pl" && hasRole("employee") && !mobile && (
          <Text size="xs" c="dimmed" mb="sm">
            {t("Tłumaczenie automatyczne. W razie wątpliwości wiążąca jest polska wersja dokumentów i wiadomości.")}
          </Text>
        )}
        <Box maw={1760} mx="auto" className="ui-route" key={location.pathname}>
          <ScreenErrorBoundary>
            <Outlet />
          </ScreenErrorBoundary>
        </Box>
        {/* na telefonie informacja nie spycha tytułu ekranu – stoi pod treścią */}
        {lang && lang !== "pl" && hasRole("employee") && mobile && (
          <p className="ui-lang-note">
            <IconLanguage size={16} aria-hidden />
            <span>{t("Tłumaczenie automatyczne. W razie wątpliwości wiążąca jest polska wersja dokumentów i wiadomości.")}</span>
          </p>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

/** Znak APT iD: litera I to pracownik (głowa, barki, ręce wzdłuż ciała), obok D. Kolory z motywu – płytka w kolorze akcentu. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 256 256"
      style={{ flex: "none", display: "block" }}
    >
      <rect width="256" height="256" rx="58" fill="var(--mantine-primary-color-filled)" />
      <g fill="var(--mantine-primary-color-contrast)" transform="translate(12.8 12.8) scale(0.9)">
        <g transform="translate(28.00 68.00) scale(1.25)"><path d="M43.00 10.00 A13 13 0 1 1 17.00 10.00 A13 13 0 1 1 43.00 10.00 Z" fillRule="evenodd"/><path d="M7 84 V55 A16 16 0 0 1 23 39 H37 A16 16 0 0 1 53 55 V84 A5 5 0 0 1 43 84 V100 H17 V84 A5 5 0 0 1 7 84 Z" fillRule="evenodd"/></g><g transform="translate(106.75 68.00) scale(1.25)"><path d="M0 0 H40 A50 50 0 0 1 40 100 H0 Z M22 22 V78 H40 A28 28 0 0 0 40 22 Z" fillRule="evenodd"/></g>
      </g>
    </svg>
  );
}

function TabLink({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  return (
    <Link to={item.to} className="tabbar-item" data-active={active || undefined} aria-current={active ? "page" : undefined}>
      <span className="tabbar-icon">
        <item.icon size={22} stroke={1.9} />
        {!!item.badge && <span className="tabbar-badge">{item.badge}</span>}
      </span>
      <span className="tabbar-label">{label}</span>
    </Link>
  );
}

function NavList({
  items,
  path,
  collapsed,
  toggleGroup,
  onNavigate,
}: {
  items: NavItem[];
  path: string;
  collapsed: string[];
  toggleGroup: (g: string) => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  return (
    <Stack gap={2}>
      {items.map((i, idx, arr) => {
        const active = isActivePath(i.to, path);
        const first = !!i.group && i.group !== arr[idx - 1]?.group;
        const closed = !!i.group && collapsed.includes(i.group) && !arr.some((x) => x.group === i.group && isActivePath(x.to, path));
        const groupBadge = first && closed ? arr.filter((x) => x.group === i.group).reduce((n, x) => n + (x.badge ?? 0), 0) : 0;
        return (
          <Fragment key={i.to + i.label}>
            {first && i.group && (
              <UnstyledButton
                onClick={() => toggleGroup(i.group as string)}
                aria-expanded={!closed}
                className="nav-group"
                mt={idx === 0 ? 0 : "md"}
              >
                <Text size="xs" fw={700} c="dimmed">
                  {t(i.group)}
                </Text>
                <Group gap={4} wrap="nowrap">
                  {groupBadge > 0 && <CountBadge n={groupBadge} />}
                  {closed ? <IconChevronRight size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />}
                </Group>
              </UnstyledButton>
            )}
            {!closed && (
              <NavLink
                component={Link}
                to={i.to}
                active={active}
                aria-current={active ? "page" : undefined}
                label={t(i.label)}
                leftSection={<i.icon size={19} stroke={1.8} />}
                rightSection={i.badge ? <CountBadge n={i.badge} /> : undefined}
                onClick={onNavigate}
                className="nav-item"
              />
            )}
          </Fragment>
        );
      })}
    </Stack>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <Badge size="sm" variant="filled" aria-label={`${n} nowych`}>
      {n}
    </Badge>
  );
}

function AccountMenu({ compact }: { compact?: boolean }): ReactNode {
  const { me, logout, hasRole, accounts, switchAccount, addAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const t = useT();
  const initials = (me?.user.full_name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const role = me ? ROLE_LABELS[me.user.role] + (me.sim_role ? " (symulacja)" : "") : "";

  return (
    <Menu position={compact ? "bottom-end" : "top-start"} width={270} closeOnItemClick opened={open} onChange={setOpen}>
      <Menu.Target>
        {compact ? (
          <UnstyledButton aria-label={t("Konto użytkownika")} p={4}>
            <Avatar radius="xl" size={36} color="orzech" variant="filled">
              {initials}
            </Avatar>
          </UnstyledButton>
        ) : (
          <UnstyledButton aria-label={t("Konto użytkownika")} className="account-button">
            <Avatar radius="xl" size={34} color="orzech" variant="light">
              {initials}
            </Avatar>
            <Box style={{ lineHeight: 1.25, minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} truncate>
                {me?.user.full_name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {role}
              </Text>
            </Box>
            <IconSelector size={16} aria-hidden />
          </UnstyledButton>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        {compact && (
          <Box px="sm" py={6}>
            <Text size="sm" fw={600}>
              {me?.user.full_name}
            </Text>
            <Text size="xs" c="dimmed">
              {role}
            </Text>
          </Box>
        )}
        <Menu.Label>{t("Konta w tej przeglądarce")}</Menu.Label>
        {accounts
          .filter((a) => a.id !== me?.user.id)
          .map((a) => (
            <Menu.Item key={a.id} leftSection={<IconSwitchHorizontal size={16} />} onClick={() => switchAccount(a.id)}>
              <Text size="sm">{a.full_name}</Text>
              <Text size="xs" c="dimmed">
                {ROLE_LABELS[a.role]} · {a.username}
              </Text>
            </Menu.Item>
          ))}
        <Menu.Item leftSection={<IconUserPlus size={16} />} onClick={addAccount}>
          {t("Dodaj konto")}
        </Menu.Item>
        <Menu.Divider />
        <SimulationMenu onDone={() => setOpen(false)} />
        <Menu.Label>{t("Motyw")}</Menu.Label>
        <Box px="xs" pb="xs">
          <SegmentedControl
            fullWidth
            size="xs"
            value={colorScheme}
            onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { value: "light", label: <Group gap={4} justify="center" wrap="nowrap"><IconSun size={14} /> {t("Jasny")}</Group> },
              { value: "dark", label: <Group gap={4} justify="center" wrap="nowrap"><IconMoon size={14} /> {t("Ciemny")}</Group> },
              { value: "auto", label: <Group gap={4} justify="center" wrap="nowrap"><IconDeviceDesktop size={14} /> {t("System")}</Group> },
            ]}
          />
        </Box>
        <Menu.Divider />
        {hasRole("employee") && (
          <>
            <Menu.Label>{t("Język aplikacji")}</Menu.Label>
            <Box px="xs" pb="xs">
              <LanguagePicker size="xs" inMenu />
            </Box>
            <Menu.Divider />
          </>
        )}
        {!hasRole("employee") && (
          <>
            <Menu.Item leftSection={<IconShieldLock size={16} />} onClick={() => navigate(MFA_PATH)}>
              Logowanie dwuetapowe
            </Menu.Item>
            <Menu.Item leftSection={<IconKey size={16} />} onClick={() => navigate("/zmiana-hasla")}>
              Zmień hasło
            </Menu.Item>
          </>
        )}
        <Menu.Item leftSection={<IconFingerprint size={16} />} onClick={() => navigate(hasRole("employee") ? "/moje-konto/klucze" : "/moje-konto")}>
          {t("Logowanie i powiadomienia")}
        </Menu.Item>
        <Menu.Item leftSection={<IconHelpCircle size={16} />} onClick={() => navigate("/pomoc")}>
          {t("Pomoc i prywatność")}
        </Menu.Item>
        <Menu.Item
          color="red"
          leftSection={<IconLogout size={16} />}
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          {t("Wyloguj")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
