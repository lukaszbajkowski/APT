import { Fragment, useState } from "react";
import { Alert } from "@mantine/core";
import { LanguagePicker, useLang, useT } from "../lib/i18n";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppShell,
  Avatar,
  Box,
  Burger,
  Group,
  Menu,
  Badge,
  NavLink,
  SegmentedControl,
  Text,
  UnstyledButton,
  useMantineColorScheme,
  type MantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown,
  IconBook,
  IconFileSpreadsheet,
  IconUserPlus,
  IconDeviceDesktop,
  IconFingerprint,
  IconMessage,
  IconSignature,
  IconSwitchHorizontal,
  IconHome,
  IconMoon,
  IconChartBar,
  IconScan,
  IconShieldLock,
  IconSun,
  IconFileText,
  IconId,
  IconSpeakerphone,
  IconListCheck,
  IconHeartbeat,
  IconKey,
  IconListDetails,
  IconShieldCheck,
  IconCertificate,
  IconChecklist,
  IconClipboardCheck,
  IconClockShield,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";

import { useAuth } from "../auth";
import { SimulationBanner, SimulationMenu } from "./Simulation";
import { api, MFA_PATH, ROLE_LABELS } from "../api";
import { useQuery } from "@tanstack/react-query";

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { me, logout, hasRole, accounts, switchAccount, addAccount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const t = useT();
  const lang = useLang();

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
  const sigCount = useQuery({
    queryKey: ["my-sig-count"],
    queryFn: () => api<{ pending: number }>("/me/signatures/count"),
    enabled: hasRole("employee"),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });
  const newMessages = count.data?.unread ?? 0;
  type NavItem = { to: string; label: string; icon: typeof IconHome; show: boolean; badge?: number; group?: string };
  const items: NavItem[] = [
    { to: "/moje-konto", label: "Moje konto", icon: IconHome, show: hasRole("employee") },
    { to: "/moje-konto/do-podpisu", label: "Do podpisu", icon: IconSignature, show: hasRole("employee"), badge: sigCount.data?.pending ?? 0 },
    { to: "/moje-konto/wiadomosci", label: "Napisz do kadr", icon: IconMessage, show: hasRole("employee"), badge: myCount.data?.unread ?? 0 },
    { to: "/moje-konto/klucze", label: "Klucze i powiadomienia", icon: IconFingerprint, show: hasRole("employee") },
    { to: "/", label: "Start", icon: IconHome, show: !hasRole("employee") },
    { to: "/do-zrobienia", label: "Do zrobienia", icon: IconListCheck, show: hasRole("admin", "hr") },

    { to: "/pracownicy", label: "Pracownicy", icon: IconId, show: !hasRole("employee"), group: "Ludzie" },
    { to: "/skaner", label: "Skaner kart", icon: IconScan, show: !hasRole("agency", "employee"), group: "Ludzie" },
    { to: "/zadania", label: "Zadania", icon: IconChecklist, show: hasRole("admin", "hr", "manager"), group: "Ludzie" },
    { to: "/szkolenia", label: "Szkolenia", icon: IconCertificate, show: hasRole("admin", "hr", "manager"), group: "Ludzie" },
    { to: "/dokumenty-pobytowe", label: "Dokumenty pobytowe", icon: IconId, show: hasRole("admin", "hr"), group: "Ludzie" },
    { to: "/braki", label: "Braki w danych", icon: IconClipboardCheck, show: hasRole("admin", "hr", "manager"), group: "Ludzie" },

    { to: "/wiadomosci", label: "Wiadomości od pracowników", icon: IconMessage, show: hasRole("admin", "hr"), badge: newMessages, group: "Komunikacja" },
    { to: "/komunikaty", label: "Komunikaty do grup", icon: IconSpeakerphone, show: hasRole("admin", "hr"), group: "Komunikacja" },
    { to: "/konta-pracownikow", label: "Konta pracowników", icon: IconFingerprint, show: hasRole("admin", "hr"), group: "Komunikacja" },

    { to: "/zgloszenia", label: "Zgłoszenia agencji", icon: IconUserPlus, show: hasRole("admin", "hr"), group: "Agencje i raporty" },
    { to: "/zgloszenia", label: "Zgłoszenia osób", icon: IconUserPlus, show: hasRole("agency"), group: "Agencje i raporty" },
    { to: "/zestawienia", label: "Zestawienie dla agencji", icon: IconFileSpreadsheet, show: hasRole("admin", "hr", "agency"), group: "Agencje i raporty" },
    { to: "/raporty", label: "Raporty", icon: IconChartBar, show: hasRole("admin", "hr", "manager"), group: "Agencje i raporty" },

    { to: "/slowniki", label: "Słowniki", icon: IconBook, show: hasRole("admin", "hr"), group: "Administracja" },
    { to: "/szablony", label: "Szablony dokumentów", icon: IconFileText, show: hasRole("admin"), group: "Administracja" },
    { to: "/uzytkownicy", label: "Użytkownicy", icon: IconUsers, show: hasRole("admin"), group: "Administracja" },
    { to: "/przeglad-dostepu", label: "Przegląd dostępu", icon: IconShieldCheck, show: hasRole("admin"), group: "Administracja" },
    { to: "/retencja", label: "Retencja danych", icon: IconClockShield, show: hasRole("admin"), group: "Administracja" },
    { to: "/stan-systemu", label: "Stan systemu", icon: IconHeartbeat, show: hasRole("admin"), group: "Administracja" },
    { to: "/dziennik", label: "Dziennik zdarzeń", icon: IconListDetails, show: hasRole("admin"), group: "Administracja" },
  ];

  const initials = (me?.user.full_name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Link to="/" className="brand-link" onClick={close}>
              <Text fw={700} className="brand-title" truncate>
                Identyfikacja pracowników APT
              </Text>
            </Link>
          </Group>
          <Menu position="bottom-end" width={260} closeOnItemClick opened={menuOpen} onChange={setMenuOpen}>
            <Menu.Target>
              <UnstyledButton aria-label="Konto użytkownika">
                <Group gap="xs">
                  <Avatar color="navy" radius="xl" size="sm">
                    {initials}
                  </Avatar>
                  <Box visibleFrom="sm" style={{ lineHeight: 1.1 }}>
                    <Text size="sm" fw={500}>
                      {me?.user.full_name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {me ? ROLE_LABELS[me.user.role] : ""}
                      {me?.sim_role ? " (symulacja)" : ""}
                    </Text>
                  </Box>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Konta w tej przeglądarce</Menu.Label>
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
              <SimulationMenu onDone={() => setMenuOpen(false)} />
              <Menu.Label>{t("Motyw")}</Menu.Label>
              <Box px="xs" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={colorScheme}
                  onChange={(v) => setColorScheme(v as MantineColorScheme)}
                  data={[
                    {
                      value: "light",
                      label: (
                        <Group gap={4} justify="center" wrap="nowrap">
                          <IconSun size={14} /> {t("Jasny")}
                        </Group>
                      ),
                    },
                    {
                      value: "dark",
                      label: (
                        <Group gap={4} justify="center" wrap="nowrap">
                          <IconMoon size={14} /> {t("Ciemny")}
                        </Group>
                      ),
                    },
                    {
                      value: "auto",
                      label: (
                        <Group gap={4} justify="center" wrap="nowrap">
                          <IconDeviceDesktop size={14} /> {t("System")}
                        </Group>
                      ),
                    },
                  ]}
                />
              </Box>
              <Menu.Divider />
              {hasRole("employee") && (
                <>
                  <Menu.Label>{t("Język")}</Menu.Label>
                  <Box px="xs" pb="xs">
                    <LanguagePicker size="xs" />
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
                {t("Klucze i powiadomienia")}
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
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {items
          .filter((i) => i.show)
          .map((i, idx, arr) => (
            <Fragment key={i.to + i.label}>
              {i.group && i.group !== arr[idx - 1]?.group && (
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pt={idx === 0 ? 0 : "md"} pb={4}>
                  {t(i.group)}
                </Text>
              )}
              <NavLink
                component={Link}
                to={i.to}
                active={i.to === "/" || i.to === "/moje-konto" ? location.pathname === i.to : location.pathname.startsWith(i.to)}
                label={t(i.label)}
                leftSection={<i.icon size={18} />}
                rightSection={i.badge ? <Badge size="sm" circle color="red">{i.badge}</Badge> : undefined}
                onClick={close}
              />
            </Fragment>
          ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <SimulationBanner />
        {lang && hasRole("employee") && (
          <Alert variant="light" color="gray" p="xs" mb="sm">
            {t("Tłumaczenie automatyczne. W razie wątpliwości wiążąca jest polska wersja dokumentów i wiadomości.")}
          </Alert>
        )}
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
