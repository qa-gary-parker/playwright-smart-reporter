export function add(a: number, b: number): number {
  return a + b;
}
export function multiply(a: number, b: number): number {
  return a * b;
}
export function sign(n: number): string {
  if (n < 0) {
    return 'negative';
  }
  return 'non-negative';
}
