/**
 * Google Workspaceでブラウザログインし、Assen用のアクセストークンを取得するCLIツール
 * CLI tool that signs in via a browser with Google Workspace and obtains an Assen access token
 * Alat CLI untuk masuk melalui browser dengan Google Workspace dan mendapatkan access token Assen
 *
 * 使い方 / Usage / Cara pakai:
 *   ASSEN_BASE_URL=https://assen-runtime-xxxx.asia-northeast1.run.app \
 *   GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com \
 *   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxx \
 *     tsx scripts/get-assen-token.ts
 *
 * 出力されたトークンは~1時間有効。Claude/CursorのMCP設定にBearerとして貼り付ける。
 * The printed token is valid for ~1 hour. Paste it as the Bearer token in Claude/Cursor's MCP config.
 * Token yang dicetak berlaku ~1 jam. Tempelkan sebagai Bearer di konfigurasi MCP Claude/Cursor.
 */
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const REDIRECT_PORT = 8945;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface AssenTokenExchangeResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`環境変数 ${name} が未設定です / environment variable ${name} is required`);
    process.exit(1);
  }
  return value;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const assenBaseUrl = requireEnv("ASSEN_BASE_URL").replace(/\/$/, "");

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("認証コードが取得できませんでした。ターミナルを確認してください。");
          server.close();
          reject(new Error("google_auth_code_missing"));
          return;
        }

        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("認証成功。ターミナルの結果を確認してください。このタブは閉じて構いません。");
        server.close();

        try {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: REDIRECT_URI,
            }),
          });
          const tokenJson = (await tokenRes.json()) as GoogleTokenResponse;
          if (!tokenRes.ok || !tokenJson.id_token) {
            throw new Error(`google_token_exchange_failed: ${tokenJson.error ?? tokenRes.status}`);
          }

          const exchangeRes = await fetch(`${assenBaseUrl}/oauth/token-exchange`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ google_id_token: tokenJson.id_token }),
          });
          const exchangeJson = (await exchangeRes.json()) as AssenTokenExchangeResponse;
          if (!exchangeRes.ok || !exchangeJson.access_token) {
            throw new Error(`assen_token_exchange_failed: ${exchangeJson.error ?? exchangeRes.status}`);
          }

          console.log("");
          console.log("Assenアクセストークンを取得しました / Assen access token acquired:");
          console.log(exchangeJson.access_token);
          console.log("");
          console.log(`有効期限 / expires in: ${exchangeJson.expires_in ?? "?"}秒 / seconds`);
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    server.listen(REDIRECT_PORT, () => {
      exec(`open "${authUrl.toString()}"`, (err) => {
        if (err) {
          console.log("ブラウザを自動で開けませんでした。次のURLを手動で開いてください:");
          console.log("Could not open browser automatically. Please open this URL manually:");
          console.log(authUrl.toString());
        }
      });
      console.log("ブラウザでGoogle Workspaceにログインしてください... / Please sign in with Google Workspace in your browser...");
    });

    setTimeout(() => {
      server.close();
      reject(new Error("timeout_waiting_for_google_callback"));
    }, 180_000);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("トークン取得に失敗しました / failed to acquire token:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
