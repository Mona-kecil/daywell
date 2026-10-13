import { notFound } from "next/navigation";
import { BodyLab } from "./body-lab";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BodyLab />;
}
