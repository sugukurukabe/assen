/**
 * freeeの認可コードフローでブラウザログインし、Assen専用freeeアプリの初回token（access_token/refresh_token）を取得するCLIツール
 * CLI tool that signs in via freee's authorization-code flow and obtains the initial token
 * (access_token/refresh_token) for Assen's dedicated freee app
 * Alat CLI yang masuk melalui alur authorization-code freee dan mendapatkan token awal
 * (access_token/refresh_token) untuk aplikasi freee khusus Assen
 *
 * 使い方 / Usage / Cara pakai:
 *   FREEE_CLIENT_ID=xxxx \
 *   FREEE_CLIENT_SECRET=xxxx \
 *     tsx scripts/get-assen-freee-token.ts
 *
 * freeeアプリ管理画面（アプリ詳細→基本設定）の「認証用URL」をそのまま渡す方法（転記ミスを防げるため推奨）:
 * Alternative that passes the "認証用URL" shown in freee's app detail screen as-is (recommended, avoids typos):
 * Alternatif dengan meneruskan "認証用URL" dari layar detail aplikasi freee (disarankan, mencegah salah salin):
 *   FREEE_AUTHORIZE_URL='https://accounts.secure.freee.co.jp/public_api/authorize?...' \
 *   FREEE_CLIENT_SECRET=xxxx \
 *     tsx scripts/get-assen-freee-token.ts
 *
 * client_id/client_secretはこのプロセスのローカル環境変数としてのみ使われ、コードやログには残さない。
 * 出力される{"accessToken","refreshToken","expiresAtEpochSeconds"}のJSONを
 * assen-freee-tokenのSecret Manager初期値として使う（docs/ops-runbook.md 6.2.1参照）。
 * client_id/client_secret are only used as this process's local environment variables and are never written to
 * code or logs. Use the printed {"accessToken","refreshToken","expiresAtEpochSeconds"} JSON as the initial value
 * of the assen-freee-token Secret (see docs/ops-runbook.md 6.2.1).
 * client_id/client_secret hanya dipakai sebagai variabel lingkungan lokal proses ini dan tidak pernah ditulis ke
 * kode atau log. Gunakan JSON {"accessToken","refreshToken","expiresAtEpochSeconds"} yang dicetak sebagai nilai
 * awal Secret assen-freee-token (lihat docs/ops-runbook.md bagian 6.2.1).
 */
import http from "node:http";
import { exec } from "node:child_process";
import crypto from "node:crypto";

const DEFAULT_REDIRECT_PORT = 8946;
const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_REDIRECT_PORT}/callback`;
const AUTHORIZE_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
const CALLBACK_TIMEOUT_MS = 300_000;

interface FreeeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`環境変数 ${name} が未設定です / environment variable ${name} is required`);
    process.exit(1);
  }
  return value;
}

interface AuthorizeTarget {
  clientId: string;
  redirectUri: string;
  callbackPort: number;
  callbackPath: string;
}

/**
 * client_idとコールバックURLを決める。FREEE_AUTHORIZE_URLがあればそこから読み取り、無ければ環境変数と既定値を使う
 * Resolves the client_id and callback URL, reading them from FREEE_AUTHORIZE_URL when provided
 * Menentukan client_id dan URL callback, membacanya dari FREEE_AUTHORIZE_URL jika tersedia
 */
function resolveAuthorizeTarget(): AuthorizeTarget {
  const authorizeUrlFromEnv = process.env.FREEE_AUTHORIZE_URL;
  let clientId: string;
  let redirectUri: string;

  if (authorizeUrlFromEnv) {
    const parsed = new URL(authorizeUrlFromEnv);
    const parsedClientId = parsed.searchParams.get("client_id");
    const parsedRedirectUri = parsed.searchParams.get("redirect_uri");
    if (!parsedClientId || !parsedRedirectUri) {
      console.error(
        "FREEE_AUTHORIZE_URL に client_id / redirect_uri が含まれていません / FREEE_AUTHORIZE_URL must contain client_id and redirect_uri",
      );
      process.exit(1);
    }
    clientId = parsedClientId;
    redirectUri = parsedRedirectUri;
  } else {
    clientId = requireEnv("FREEE_CLIENT_ID");
    redirectUri = process.env.FREEE_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  }

  const parsedRedirect = new URL(redirectUri);
  if (parsedRedirect.hostname !== "localhost" && parsedRedirect.hostname !== "127.0.0.1") {
    console.error(
      `コールバックURLがlocalhostではないためこのツールでは受け取れません: ${redirectUri} / this tool can only receive localhost callbacks`,
    );
    process.exit(1);
  }

  return {
    clientId,
    redirectUri,
    callbackPort: Number(parsedRedirect.port || DEFAULT_REDIRECT_PORT),
    callbackPath: parsedRedirect.pathname,
  };
}

async function main(): Promise<void> {
  const { clientId, redirectUri, callbackPort, callbackPath } = resolveAuthorizeTarget();
  const clientSecret = requireEnv("FREEE_CLIENT_SECRET");

  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  // 複数事業所に所属するアカウントのため、事業所選択画面を必ず出す（スグクル株式会社=10745310を選ぶ）
  // The account belongs to multiple companies, so always show the company picker (choose スグクル株式会社=10745310)
  // Akun memiliki beberapa perusahaan, jadi selalu tampilkan pemilih perusahaan (pilih スグクル株式会社=10745310)
  authUrl.searchParams.set("prompt", "select_company");

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", `http://localhost:${callbackPort}`);
        if (url.pathname !== callbackPath) {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          const errorParam = url.searchParams.get("error");
          const errorDescription = url.searchParams.get("error_description");
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("認可コードが取得できませんでした。ターミナルを確認してください。");
          server.close();
          reject(
            new Error(
              `freee_auth_code_missing query=${url.search} error=${errorParam ?? "-"} error_description=${errorDescription ?? "-"} stateMatch=${returnedState === state}`,
            ),
          );
          return;
        }

        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("認可成功。ターミナルの結果を確認してください。このタブは閉じて構いません。");
        server.close();

        try {
          const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: redirectUri,
            }),
          });
          const tokenJson = (await tokenRes.json()) as FreeeTokenResponse;
          if (!tokenRes.ok || !tokenJson.access_token || !tokenJson.refresh_token || !tokenJson.expires_in) {
            throw new Error(`freee_token_exchange_failed: ${tokenJson.error ?? tokenRes.status} ${tokenJson.error_description ?? ""}`);
          }

          const secretValue = {
            accessToken: tokenJson.access_token,
            refreshToken: tokenJson.refresh_token,
            expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + tokenJson.expires_in,
          };

          console.log("");
          console.log("freeeトークンを取得しました / freee token acquired.");
          console.log("次のJSONを assen-freee-token Secret の初期値として使ってください:");
          console.log("Use the following JSON as the initial value of the assen-freee-token Secret:");
          console.log("");
          console.log(JSON.stringify(secretValue));
          console.log("");
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    server.listen(callbackPort, () => {
      exec(`open "${authUrl.toString()}"`, (err) => {
        if (err) {
          console.log("ブラウザを自動で開けませんでした。次のURLを手動で開いてください:");
          console.log("Could not open browser automatically. Please open this URL manually:");
          console.log(authUrl.toString());
        }
      });
      console.log("ブラウザでfreeeにログインし、スグクル株式会社の事業所を選んで許可してください... / Please sign in to freee in your browser, select the スグクル株式会社 company, and approve access...");
    });

    setTimeout(() => {
      server.close();
      reject(new Error("timeout_waiting_for_freee_callback"));
    }, CALLBACK_TIMEOUT_MS);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("トークン取得に失敗しました / failed to acquire token:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
