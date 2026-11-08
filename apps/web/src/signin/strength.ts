/** 0 to 4, for the sign-up meter: length first, then variety. The server has the final word. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 12) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((r) => r.test(password)).length;
  const score = (password.length >= 16 ? 2 : 1) + (kinds >= 3 ? 1 : 0) + (password.length >= 20 ? 1 : 0);
  return Math.min(4, score) as 1 | 2 | 3 | 4;
}
