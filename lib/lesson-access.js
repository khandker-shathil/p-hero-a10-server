export function lessonAccess(lesson, user) {
  if (!user) return 401
  if (!lesson) return 404
  const owner = String(lesson.creatorId) === String(user.id)
  if (lesson.visibility !== "public" && !owner && user.role !== "admin") return 404
  if (lesson.accessLevel === "premium" && !owner && !user.isPremium) return 403
  return 200
}

export const REPORT_REASONS = ["Inappropriate content", "Spam or advertising", "Harassment or hate speech", "Misleading information", "Other"]
