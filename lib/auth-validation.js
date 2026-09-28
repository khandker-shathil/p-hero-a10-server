export function passwordError(password) {
  if (typeof password !== "string" || password.length < 6)
    return "Password must have at least 6 characters."
  if (password.length > 128)
    return "Password must have no more than 128 characters."
  if (!/[A-Z]/.test(password))
    return "Password must include an uppercase letter."
  if (!/[a-z]/.test(password))
    return "Password must include a lowercase letter."
  return null
}
