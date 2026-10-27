import { Box } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { withAcct, type Employee } from "../api";

export function EmployeePhoto({ employee, width }: { employee: Employee; width: number }) {
  const height = Math.round((width * 4) / 3);
  if (!employee.has_photo || !employee.photo_version) {
    return (
      <Box
        w={width}
        h={height}
        className="photo-placeholder"
        style={{ borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
        aria-label="Brak zdjęcia"
      >
        <IconUser size={Math.max(16, width / 2.5)} color="var(--mantine-color-gray-5)" />
      </Box>
    );
  }
  return (
    <img
      src={withAcct(`/api/employees/${employee.id}/photo?v=${employee.photo_version}`)}
      alt={`Zdjęcie: ${employee.first_name} ${employee.last_name}`}
      width={width}
      height={height}
      loading="lazy"
      style={{ borderRadius: 6, objectFit: "cover", display: "block", flex: "none" }}
    />
  );
}
