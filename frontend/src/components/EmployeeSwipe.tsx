import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IconChevronRight, IconMessage } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { SwipeRow, type RowAction } from "./Mobile";

/** Wiersz listy, który dotyczy pracownika (np. kończący się dokument, szkolenie): na telefonie
 *  przesunięcie w lewo – „Napisz” (kadry), przytrzymanie – menu z „Otwórz kartę”. */
export function EmployeeSwipe({ id, name, about, children }: { id: number; name: string; about?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const actions: RowAction[] = [];
  if (hasRole("admin", "hr"))
    actions.push({ label: "Napisz", tone: "accent", icon: <IconMessage size={20} />, onClick: () => navigate(`/wiadomosci?do=${id}&nazwa=${encodeURIComponent(name)}`) });
  actions.push({ label: "Otwórz kartę", icon: <IconChevronRight size={20} />, menuOnly: true, onClick: () => navigate(`/pracownicy/${id}`) });
  return (
    <SwipeRow actions={actions} menuTitle={name} menuSubtitle={about}>
      {children}
    </SwipeRow>
  );
}
