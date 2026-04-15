// ============================================
// WOFF ハンズオン用 GAS バックエンド (Code.gs)
// ============================================

// --- ユーザー設定エリア ---
const CONFIG = {
  CLIENT_ID: "ySF_kyNec1pxPpC2Cfsc",
  CLIENT_SECRET: "A0O_URcqSX",
  SERVICE_ACCOUNT: "75gnc.serviceaccount@works-demo.org",
  DOMAIN_ID: "10000389",
  BOT_ID: "10749150",
  PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----
ユーザーの実際のPrivateKeyに置き換えてください
-----END PRIVATE KEY-----`,
  SHEET_ID: "16UMyL58J6_hDkPOGcPYSkCQoq5YPiR8hW2QkKnu3Kjw", // 保存先のスプレッドシートID
  SUPERVISOR_USER_ID: "jumpei.muramatsu@works-demo.org" // 承認・却下依頼を送る対象のユーザーID（固定）
};
// ------------------------

/**
 * JWTを生成し、LINE WORKS API (v2) のアクセストークンを取得する
 */
function getAccessToken() {
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claim = {
    iss: CONFIG.CLIENT_ID,
    sub: CONFIG.SERVICE_ACCOUNT,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  };

  const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=/g, '');
  const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=/g, '');
  const signatureBase = encodedHeader + "." + encodedClaim;
  const signature = Utilities.computeRsaSha256Signature(signatureBase, CONFIG.PRIVATE_KEY);
  const encodedSignature = Utilities.base64EncodeWebSafe(signature).replace(/=/g, '');
  const jwt = signatureBase + "." + encodedSignature;

  const url = "https://auth.worksmobile.com/oauth2/v2.0/token";
  const payload = {
    assertion: jwt,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET,
    scope: "bot"
  };

  const options = {
    method: "post",
    payload: payload
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  return json.access_token;
}

/**
 * doPost : Webhook および Webアプリとしてのエンドポイント
 */
function doPost(e) {
  try {
    const postData = e.postData.contents;
    const data = JSON.parse(postData);

    // 1. フロントエンド（HTML）からのPOST
    if (data.type === "frontend_submit") {
      const accessToken = getAccessToken();
      
      // Postbackに乗せるデータを構築 (上限1000文字以内)
      // JSON形式だとクオート等で長くなるためURLエンコード文字列などにする事も可能だが今回はJSONで扱う
      const actionData = {
        action: "approve",
        worker: data.worker,
        date: data.date,
        start: data.start,
        end: data.end,
        category: data.category,
        detail: data.detail
      };
      
      const messageContent = {
        content: {
          type: "button_template",
          contentText: `日報申請が届きました。\n\n【作業者】${data.worker}\n【日時】${data.date} ${data.start}〜${data.end}\n【作業区分】${data.category}\n【詳細】${data.detail}`,
          actions: [
            {
              type: "postback",
              label: "承認",
              data: JSON.stringify(actionData) // postbackに乗せる
            },
            {
              type: "postback",
              label: "却下",
              data: JSON.stringify({ action: "reject" })
            }
          ]
        }
      };

      const url = `https://www.worksapis.com/v1.0/bots/${CONFIG.BOT_ID}/users/${CONFIG.SUPERVISOR_USER_ID}/messages`;
      UrlFetchApp.fetch(url, {
        method: "post",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(messageContent)
      });

      return ContentService.createTextOutput("Success")
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // 2. LINE WORKS BotからのPOST（Postback Callback）
    if (data.type === "postback") {
      const postbackDataRaw = data.content.postback;
      const postbackData = JSON.parse(postbackDataRaw);
      const userId = data.source.userId;

      if (postbackData.action === "approve") {
        // スプレッドシートに書き込み
        appendRowToSheet([
          new Date(), // 承認日時
          postbackData.worker,
          postbackData.date,
          postbackData.start,
          postbackData.end,
          postbackData.category,
          postbackData.detail,
          "承認済み",
          userId // 承認者
        ]);

        // 結果をBotで返信
        replyMessage(getAccessToken(), userId, `${postbackData.worker}さんの日報を承認し、スプレッドシートに記録しました。`);
      } else if (postbackData.action === "reject") {
        replyMessage(getAccessToken(), userId, `日報を却下しました。`);
      }
    }
    
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    console.error("Error in doPost", error);
    return ContentService.createTextOutput("Error: " + error.message).setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * 簡易的なメッセージ送信（確認用）
 */
function replyMessage(accessToken, userId, text) {
  const url = `https://www.worksapis.com/v1.0/bots/${CONFIG.BOT_ID}/users/${userId}/messages`;
  UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      content: {
        type: "text",
        text: text
      }
    })
  });
}

function appendRowToSheet(rowData) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheets()[0];
  sheet.appendRow(rowData);
}

// OPTIONS はCORS対応用（もし必要になった場合）
function doOptions(e) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(headers);
}
