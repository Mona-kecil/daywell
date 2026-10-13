import { notFound } from "next/navigation";
import { InsightsLab } from "./insights-lab";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InsightsLab />;
}
