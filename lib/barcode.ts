export function validBarcode(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
    sum += Number(code[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

export const barcodeKey = (code: string) => code.padStart(14, "0");
