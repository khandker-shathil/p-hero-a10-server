export function lessonAccess(lesson, user) {
  if (!lesson) return 404
  if (!user) {
    if (lesson.visibility !== "public") return 404
    return lesson.accessLevel === "premium" ? 401 : 200
  }
  const owner = String(lesson.creatorId) === String(user.id)
  if (lesson.visibility !== "public" && !owner && user.role !== "admin") return 404
  if (lesson.accessLevel === "premium" && !owner && !user.isPremium) return 403
  return 200
}

export const REPORT_REASONS = ["Inappropriate content", "Spam or advertising", "Harassment or hate speech", "Misleading information", "Other"]
