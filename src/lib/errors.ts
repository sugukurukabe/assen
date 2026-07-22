/**
 * ドメイン層で使う構造化エラー。ユーザー入力ミスとシステムエラーを区別する
 * Structured errors used across the domain layer. Distinguishes user input mistakes from system errors
 * Error terstruktur yang digunakan di seluruh lapisan domain. Membedakan kesalahan input pengguna dari error sistem
 */
export class UserInputError extends Error {
  public readonly remediation: string;

  constructor(message: string, remediation: string) {
    super(message);
    this.name = "UserInputError";
    this.remediation = remediation;
  }
}

/**
 * 承認・状態機械の不正遷移エラー
 * Invalid state-machine transition error (e.g. approval, execution status)
 * Error transisi mesin status yang tidak valid (misalnya approval, execution status)
 */
export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

/**
 * rule_result が ambiguous / expert_review_required のとき書類確定をブロックするために使う
 * Used to block document finalization when rule_result is ambiguous / expert_review_required
 * Digunakan untuk memblokir finalisasi dokumen saat rule_result adalah ambiguous / expert_review_required
 */
export class ExpertReviewRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpertReviewRequiredError";
  }
}

/**
 * リクエストボディ・入力バイト列が上限を超えた場合のエラー。HTTP 413へ変換される
 * Error thrown when a request body or input byte string exceeds the configured limit. Maps to HTTP 413
 * Error yang dilempar saat body permintaan atau byte string input melebihi batas yang dikonfigurasi. Dipetakan ke HTTP 413
 */
export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * システム内部エラー。ユーザーには一般的なメッセージのみ返し、詳細はログにのみ出力する
 * Internal system error. Only a generic message is returned to the user; details go to logs only
 * Error sistem internal. Hanya pesan umum yang dikembalikan ke pengguna; detail hanya masuk ke log
 */
export class SystemError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "SystemError";
  }
}
