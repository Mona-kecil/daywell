"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, RotateCcw, ScanBarcode, Trash2 } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { manualError, manualMealSchema, mealSummary } from "@/lib/manual-meal";
import { savedMealSchema } from "@/lib/saved-meals";
import { MakesPicker } from "./makes-picker";
import { scaleNutrients, sumNutrients, type Macros } from "@/lib/nutrients";
import { Sheet, timeLabel, useTask } from "./ui";

type Product = NonNullable<FunctionReturnType<typeof api.food.lookupBarcode>>;

const whole = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const macroLine = (m: Macros) =>
  `${whole(m.kcal)} kcal · P ${whole(m.protein)} · F ${whole(m.fat)} · C ${whole(m.carbs)} g`;

// One tap re-logs a recent meal at the current time, without its photo.
export function RecentMeals() {
  const latest = useQuery(api.meals.recent, { limit: 20 });
  // Re-logging creates a new meal, so keep only the newest of each.
  const recent = latest
    ?.filter(
      (m, i) => latest.findIndex((x) => x.description === m.description) === i,
    )
    .slice(0, 6);
  const repeat = useMutation(api.meals.repeat),
    deleteMeal = useMutation(api.meals.deleteMeal);
  const { run, pending } = useTask();
  const [busy, setBusy] = useState<Id<"meals"> | null>(null);
  if (!recent?.length) return null;
  return (
    <section className="card recent-meals" aria-labelledby="recent-title">
      <h2 id="recent-title">Log again</h2>
      <ul>
        {recent.map((meal) => (
          <li key={meal.id}>
            <button
              type="button"
              disabled={pending}
              aria-label={`Log ${meal.description} again, ${whole(meal.kcal)} kcal`}
              onClick={() => {
                setBusy(meal.id);
                void run(
                  () => repeat({ mealId: meal.id, at: Date.now() }),
                  `Logged ${meal.description}`,
                  (id) => deleteMeal({ id }),
                ).finally(() => setBusy(null));
              }}
            >
              <span className="recent-name">{meal.description}</span>
              <span className="muted small">
                {whole(meal.kcal)} kcal ·{" "}
                {new Date(meal.at).toLocaleDateString([], {
                  weekday: "short",
                })}{" "}
                {timeLabel(meal.at)}
              </span>
              <RotateCcw
                size={16}
                className={busy === meal.id ? "spin" : undefined}
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector;
  }
}

// Streams the rear camera into a video and reports each new barcode once,
// so a code that found nothing isn't looked up again while it stays in view.
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useEffectEvent(onCode);
  useEffect(() => {
    const Barcode = window.BarcodeDetector;
    if (!Barcode) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    let last: string | null = null;
    const detector = new Barcode({ formats: ["ean_13", "ean_8", "upc_a"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (s) => {
        stream = s;
        // Permission can resolve after the sheet closed; release the camera.
        if (stopped || !video.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = s;
        await video.current.play();
        if (stopped) return;
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const [hit] = await detector.detect(video.current).catch(() => []);
          if (hit && !stopped && hit.rawValue !== last) {
            last = hit.rawValue;
            navigator.vibrate?.(60);
            report(hit.rawValue);
          }
        }, 250);
      })
      .catch(() => {
        if (!stopped) setError("Camera unavailable. Type the code instead.");
      });
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  if (error) return <p className="small amber-text">{error}</p>;
  return (
    <div className="scanner">
      <video ref={video} muted playsInline aria-label="Camera preview" />
      <span className="scanner-frame" aria-hidden />
    </div>
  );
}

export function BarcodeSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Scan a barcode">
      <BarcodeBody onDone={onClose} />
    </Sheet>
  );
}

function BarcodeBody({ onDone }: { onDone: () => void }) {
  const lookup = useAction(api.food.lookupBarcode);
  const addManual = useMutation(api.meals.addManual);
  const { run, pending } = useTask();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Product | null | undefined>(undefined);
  const [grams, setGrams] = useState(100);
  const [camera] = useState(() => !!window.BarcodeDetector);
  const search = (value: string) => {
    setCode(value);
    void run(async () => {
      const product = await lookup({ code: value.trim() });
      setFound(product);
      if (product) setGrams(product.servingGrams ?? 100);
    });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!found) return;
    const name = found.description;
    void run(async () => {
      await addManual({
        at: Date.now(),
        description: [found.brand, name].filter(Boolean).join(" · "),
        items: [{ name, grams, fdcId: found.fdcId, per100g: found.per100g }],
      });
      onDone();
    }, `Logged ${name}`);
  };
  if (found)
    return (
      <form className="sheet-section barcode-result" onSubmit={save}>
        {found.brand && <p className="eyebrow">{found.brand}</p>}
        <h3>{found.description}</h3>
        <p className="muted small">
          Per 100 g: {macroLine(found.per100g)}
          {found.servingGrams !== null &&
            ` · serving ${whole(found.servingGrams)} g`}
        </p>
        <label htmlFor="barcode-grams">How much did you have?</label>
        <span className="unit-input">
          <input
            id="barcode-grams"
            type="number"
            inputMode="decimal"
            min={0}
            max={10000}
            step="any"
            required
            value={grams}
            onChange={(e) => setGrams(Number(e.target.value))}
          />
          <span>g</span>
        </span>
        <p className="nutrient-line small" aria-live="polite">
          {grams > 0
            ? macroLine(scaleNutrients(found.per100g, grams))
            : "Enter an amount"}
        </p>
        <div className="row form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFound(undefined)}
          >
            Scan another
          </button>
          <button className="primary-button" disabled={pending || !(grams > 0)}>
            Log it
          </button>
        </div>
      </form>
    );
  return (
    <div className="sheet-section">
      {camera ? (
        <>
          <CameraScanner onCode={(c) => !pending && search(c)} />
          <p className="muted small">
            Point the camera at the barcode on the package.
          </p>
        </>
      ) : (
        <p className="muted small">
          This browser can’t scan with the camera. Type the digits under the
          barcode instead.
        </p>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          search(code);
        }}
      >
        <label className="sr-only" htmlFor="barcode-code">
          Barcode number
        </label>
        <input
          id="barcode-code"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{8}|\d{12}|\d{13}"
          title="8, 12 or 13 digits"
          placeholder="e.g. 4006381333931"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <button className="soft-button" disabled={pending}>
          {pending ? "Looking…" : "Look up"}
        </button>
      </form>
      {found === null && (
        <p className="small amber-text" role="status">
          No USDA product with complete nutrients matches {code}. Enter it
          manually instead.
        </p>
      )}
    </div>
  );
}

type Row = {
  key: number;
  name: string;
  grams: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
};
const blank = (key: number): Row => ({
  key,
  name: "",
  grams: "100",
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
});
const MACRO_FIELDS = [
  ["kcal", "kcal"],
  ["protein", "Protein g"],
  ["fat", "Fat g"],
  ["carbs", "Carbs g"],
] as const;

export function ManualMealSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Enter a meal">
      <ManualBody onDone={onClose} />
    </Sheet>
  );
}

// People know a portion's label values, so convert them to per-100 g here.
// In save mode the same form builds a saved meal instead of logging one.
export function ManualBody({
  onDone,
  mode = "log",
}: {
  onDone: () => void;
  mode?: "log" | "save";
}) {
  const addManual = useMutation(api.meals.addManual),
    create = useMutation(api.savedMeals.create),
    remove = useMutation(api.savedMeals.remove);
  const { run, pending } = useTask();
  const saving = mode === "save";
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState(1);
  const [rows, setRows] = useState<Row[]>([blank(0)]);
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const items = rows.map((r) => {
    const grams = Number(r.grams);
    const per = (v: string) => ((Number(v) || 0) / grams) * 100;
    return {
      name: r.name.trim(),
      grams,
      per100g: {
        kcal: per(r.kcal),
        protein: per(r.protein),
        carbs: per(r.carbs),
        fat: per(r.fat),
      },
    };
  });
  const total = sumNutrients(
    rows.map((r) => ({
      kcal: Number(r.kcal) || 0,
      protein: Number(r.protein) || 0,
      carbs: Number(r.carbs) || 0,
      fat: Number(r.fat) || 0,
    })),
  );
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (saving) {
      const recipe = { name: description.trim(), items, servings };
      const parsed = savedMealSchema.safeParse(recipe);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        setError(
          issues.some((i) => i.path[0] === "name")
            ? "Give the meal a name."
            : manualError(issues, items),
        );
        return;
      }
      setError(null);
      void run(
        async () => {
          const id = await create(recipe);
          onDone();
          return id;
        },
        `Saved ${recipe.name}`,
        (id) => remove({ id }),
      );
      return;
    }
    const meal = {
      at: Date.now(),
      description: description.trim() || mealSummary(items.map((i) => i.name)),
      items,
    };
    // The server's own rules, so nothing it would reject gets sent.
    const parsed = manualMealSchema.safeParse(meal);
    if (!parsed.success) {
      setError(manualError(parsed.error.issues, items));
      return;
    }
    setError(null);
    void run(async () => {
      await addManual(meal);
      onDone();
    }, "Meal logged");
  };
  return (
    <form className="sheet-section manual-meal" onSubmit={save}>
      <p className="muted small">
        Enter each food’s amount and its nutrition for that amount, as on the
        label.
        {saving &&
          " For a batch, enter the whole recipe and how many servings it makes."}
      </p>
      <label htmlFor="manual-description">
        {saving ? (
          "Name"
        ) : (
          <>
            Meal name <span className="muted">(optional)</span>
          </>
        )}
      </label>
      <input
        id="manual-description"
        required={saving}
        maxLength={saving ? 80 : 4000}
        placeholder={saving ? "Overnight oats" : "Lunch at the café"}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {saving && (
        <MakesPicker
          id="manual-makes"
          value={servings}
          onChange={setServings}
        />
      )}
      <ol className="manual-items">
        {rows.map((r, i) => (
          <li key={r.key}>
            <div className="manual-head">
              <label className="grow">
                <span className="sr-only">Food {i + 1} name</span>
                <input
                  required
                  maxLength={200}
                  placeholder={`Food ${i + 1}`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                />
              </label>
              <label className="unit-input manual-grams">
                <span className="sr-only">Food {i + 1} grams</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10000}
                  step="any"
                  required
                  value={r.grams}
                  onChange={(e) => update(r.key, { grams: e.target.value })}
                />
                <span>g</span>
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove food ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((rs) => rs.filter((x) => x.key !== r.key))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="manual-macros">
              {MACRO_FIELDS.map(([field, label]) => (
                <label key={field}>
                  <span className="small muted">{label}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={field === "kcal" ? 10000 : 1000}
                    step="any"
                    placeholder="0"
                    aria-label={`Food ${i + 1} ${label}`}
                    value={r[field]}
                    onChange={(e) => update(r.key, { [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="text-button"
        disabled={rows.length >= 30}
        onClick={() =>
          setRows((rs) => [...rs, blank(Math.max(...rs.map((r) => r.key)) + 1)])
        }
      >
        <Plus size={15} /> Add another food
      </button>
      <p className="nutrient-line small" aria-live="polite">
        Total: {macroLine(total)}
        {saving && servings > 1 && (
          <>
            <br />
            {servings} servings of{" "}
            {macroLine({
              kcal: total.kcal / servings,
              protein: total.protein / servings,
              fat: total.fat / servings,
              carbs: total.carbs / servings,
            })}
          </>
        )}
      </p>
      {error && (
        <p className="small amber-text" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button full" disabled={pending}>
        {saving ? "Save meal" : "Log meal"}
      </button>
    </form>
  );
}

export function AddMealOptions() {
  const [sheet, setSheet] = useState<"barcode" | "manual" | null>(null);
  return (
    <>
      <div className="capture-alt">
        <button
          type="button"
          className="soft-button"
          aria-haspopup="dialog"
          onClick={() => setSheet("barcode")}
        >
          <ScanBarcode size={17} /> Scan barcode
        </button>
        <button
          type="button"
          className="soft-button"
          aria-haspopup="dialog"
          onClick={() => setSheet("manual")}
        >
          <Plus size={17} /> Enter manually
        </button>
      </div>
      <BarcodeSheet open={sheet === "barcode"} onClose={() => setSheet(null)} />
      <ManualMealSheet
        open={sheet === "manual"}
        onClose={() => setSheet(null)}
      />
    </>
  );
}
