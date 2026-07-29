export function looksLikeQuizBlock(message: string): boolean {
  const lines = message.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return false;

  const numberedPattern = /^\d{1,2}[.)]\s/;
  const letterPattern = /^[a-h][.)]\s/i;
  const bulletPattern = /^[-•*]\s/;

  let numberedCount = 0;
  let letterCount = 0;
  let bulletCount = 0;

  for (const line of lines) {
    if (numberedPattern.test(line)) {
      numberedCount++;
    } else if (letterPattern.test(line)) {
      letterCount++;
    } else if (bulletPattern.test(line)) {
      bulletCount++;
    }
  }

  const totalPatternItems = numberedCount + letterCount + bulletCount;
  if (totalPatternItems >= 3) {
    if (numberedCount >= 3 || bulletCount >= 3) return true;
    if (letterCount >= 3 && numberedCount === 0 && bulletCount === 0) return false;
    return true;
  }

  const questionMarks = (message.match(/\?/g) || []).length;
  if (questionMarks >= 3) return true;

  return false;
}