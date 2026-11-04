// 機能のON/OFF。
//
// online: オンライン対戦（ランダムマッチ・友達とルームで）。
//   false … タイトル画面に表示せず、Firebase にも接続しない（ひとりで遊ぶ・1台でみんなで のみ）。
//   true  … オンライン対戦を開放する。js/firebase-config.js の設定と、
//           Firebase の Realtime Database ルール（database.rules.json）が必要。
export const FEATURES = {
  online: false,
};
