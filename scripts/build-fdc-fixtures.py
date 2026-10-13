"""Build hand-written search cases from USDA SR Legacy CSV nutrient rows."""
import csv
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCE = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
CASES = [
    ("white rice cooked", 169757, ["rice"]),
    ("chicken breast grilled", 171534, ["chicken"]),
    ("broccoli", 169967, ["broccoli"]),
    ("egg", 173424, ["egg", "eggs"]),
    ("oatmeal", 173905, ["oatmeal", "oats"]),
    ("banana", 173944, ["banana", "bananas"]),
    ("salmon", 175168, ["salmon"]),
    ("Greek yogurt", 170894, ["yogurt", "yoghurt"]),
    ("avocado", 171705, ["avocado", "avocados"]),
    ("olive oil", 171413, ["olive oil"]),
    ("bread", 172688, ["bread", "toast"]),
    ("pasta cooked", 169737, ["pasta", "spaghetti"]),
]


def main():
    with urllib.request.urlopen(SOURCE) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    def rows(filename):
        name = next(n for n in archive.namelist() if n.endswith("/" + filename))
        return csv.DictReader(io.TextIOWrapper(archive.open(name)))

    foods = {int(r["fdc_id"]): r for r in rows("food.csv")}
    nutrients = {int(r["id"]): r for r in rows("nutrient.csv")}
    ids = {food_id for _, food_id, _ in CASES}
    values = {}
    for row in rows("food_nutrient.csv"):
        food_id, nutrient_id = int(row["fdc_id"]), int(row["nutrient_id"])
        if food_id in ids and nutrient_id in {1008, 1003, 1004, 1005}:
            values.setdefault(food_id, []).append({
                "nutrientId": nutrient_id,
                "nutrientName": nutrients[nutrient_id]["name"],
                "nutrientNumber": nutrients[nutrient_id]["nutrient_nbr"],
                "unitName": nutrients[nutrient_id]["unit_name"],
                "value": float(row["amount"]),
            })
    cases = []
    for query, food_id, aliases in CASES:
        cases.append({
            "query": query,
            "aliases": aliases,
            "response": {
                "totalHits": 1, "currentPage": 1, "totalPages": 1,
                "pageList": [1],
                "foodSearchCriteria": {"query": query, "pageSize": 25, "dataType": ["SR Legacy"]},
                "foods": [{
                    "fdcId": food_id, "description": foods[food_id]["description"],
                    "dataType": "SR Legacy", "score": 1,
                    "foodNutrients": sorted(values[food_id], key=lambda n: n["nutrientId"]),
                }],
            },
        })
    fixture = {
        "provenance": "Hand-built FDC search fixtures; not captured live search responses. Nutrient values per 100 g copied from the USDA SR Legacy April 2018 CSV archive.",
        "source": SOURCE,
        "cases": cases,
    }
    target = Path(__file__).resolve().parents[1] / "lib/fixtures/fdc-search.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(fixture, indent=2) + "\n")


if __name__ == "__main__":
    main()
