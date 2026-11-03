// Firebase の設定（Firebase コンソール →「プロジェクトの設定」→「マイアプリ」の値）。
// ウェブアプリ用の apiKey は公開されても問題ない値です（アクセス制御は database.rules.json で行います）。
// null にするとデモモード（同じブラウザの別タブ同士でのみ対戦）で動きます。

export const firebaseConfig = {
  apiKey: 'AIzaSyCOYoYkDImeX8VXRbaq5OqyHIs5r-zYgVs',
  authDomain: 'beppan-game.firebaseapp.com',
  databaseURL: 'https://beppan-game-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'beppan-game',
  storageBucket: 'beppan-game.firebasestorage.app',
  messagingSenderId: '672246300626',
  appId: '1:672246300626:web:129d96d9748dbb6f8ad20b',
  measurementId: 'G-V851T053DX',
};
