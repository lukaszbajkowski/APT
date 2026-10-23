import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppShell, Burger, Group, Menu, NavLink, Text, UnstyledButton, Avatar } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown,
  IconHome,
  IconKey,
  IconListDetails,
  IconLogout,
  IconUsers,
} from "@tabler/icons-react";

import { useAuth } from "../auth";
import { ROLE_LABELS } from "../api";

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { me, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { to: "/", label: "Start", icon: IconHome, show: true },
    { to: "/uzytkownicy", label: "Użytkownicy", icon: IconUsers, show: hasRole("admin") },
    { to: "/dziennik", label: "Dziennik zdarzeń", icon: IconListDetails, show: hasRole("admin") },
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
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} c="navy.9">
              Identyfikacja pracowników APT
            </Text>
          </Group>
          <Menu position="bottom-end" width={220}>
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs">
                  <Avatar color="navy" radius="xl" size="sm">
                    {initials}
                  </Avatar>
                  <div style={{ lineHeight: 1.1 }}>
                    <Text size="sm" fw={500}>
                      {me?.user.full_name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {me ? ROLE_LABELS[me.user.role] : ""}
                    </Text>
                  </div>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconKey size={16} />} onClick={() => navigate("/zmiana-hasla")}>
                Zmień hasło
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconLogout size={16} />}
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
              >
                Wyloguj
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <NavLink
              key={i.to}
              component={Link}
              to={i.to}
              active={i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)}
              label={i.label}
              leftSection={<i.icon size={18} />}
              onClick={close}
            />
          ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
