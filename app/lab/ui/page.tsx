import { notFound } from "next/navigation";
import { UiLab } from "./ui-lab";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiLab />;
}
