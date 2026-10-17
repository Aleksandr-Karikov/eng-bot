/** Голосовые с озвучкой, которые бот прислал в личке во время /learn, — удаляются при переходе к следующей карточке. */
export class VoiceStore {
  private readonly sent = new Map<number, number[]>();

  add(userId: number, messageId: number): void {
    this.sent.set(userId, [...(this.sent.get(userId) ?? []), messageId]);
  }

  take(userId: number): number[] {
    const ids = this.sent.get(userId) ?? [];
    this.sent.delete(userId);
    return ids;
  }
}
