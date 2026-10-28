import { useSearchParams } from "react-router-dom";
import { Messenger } from "../components/HrThreads";

export function HrMessagesPage() {
  const [params] = useSearchParams();
  const id = params.get("do");
  const preset = id && /^\d+$/.test(id) ? { id, name: params.get("nazwa") ?? `#${id}` } : undefined;
  return <Messenger staff preset={preset} />;
}
