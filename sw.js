/* 오늘의 퀘스트 보드 — 오프라인 캐시
 *
 * 고친 이유 (2026-09-10)
 *  1) addAll 은 하나만 실패해도 전부 실패한다. 게다가 그 실패를 조용히 삼키고 있어서
 *     "빈 캐시로 설치 완료" 가 될 수 있었다. 그 상태로 인터넷이 끊기면 앱이 아예 안 열린다.
 *     → 파일을 하나씩 담고, 실패한 것만 건너뛴다.
 *  2) respondWith 에 undefined 를 넘기면 브라우저 오류 화면이 뜬다.
 *     → 어떤 경로로 와도 반드시 Response 를 돌려준다.
 *  3) 글꼴(fonts.googleapis.com)은 type 이 basic 이 아니라 캐시가 안 되고 있었다.
 *     매번 네트워크를 기다렸고, DNS 가 흔들리면 여기서 한참 멈췄다.
 *     → 글꼴은 별도 캐시에 담아두고, 있으면 그걸 먼저 준다.
 *  4) 보드 화면(navigate)은 캐시를 먼저 주고 새 버전은 뒤에서 받아둔다.
 *     껍데기는 즉시 뜨고, 내 자료는 localStorage 에 있으니 바로 쓸 수 있다.
 */
/* 캐시 이름에 버전을 붙이지 않는다. 보드 화면은 열 때마다 뒤에서 새로 받아
   이 캐시에 덮어쓰고, 새 내용이면 화면에 "새로고침" 버튼을 띄운다.
   그래서 앱을 고칠 때 index.html 만 올리면 되고 이 파일은 손대지 않아도 된다. */
var CACHE = "questboard-shell";           /* 앱 파일 */
var FONTS = "questboard-fonts";           /* 글꼴 — 버전과 무관하게 오래 남긴다 */
var SHELL = "./index.html";
var ASSETS = ["./", "./index.html", "./manifest.json",
              "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];

function putSafe(cacheName, req, res){
  try{
    var copy = res.clone();
    caches.open(cacheName).then(function(c){ c.put(req, copy).catch(function(){}); });
  }catch(e){}
}

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* 하나씩 담는다 — 한 개가 실패해도 나머지는 남는다 */
      return Promise.all(ASSETS.map(function(u){
        return c.add(new Request(u, { cache:"reload" })).catch(function(){});
      }));
    }).catch(function(){})
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        /* 글꼴 캐시는 남기고, 옛 버전 앱 캐시만 지운다 */
        if(k === CACHE || k === FONTS) return null;
        return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); }).catch(function(){})
  );
});

/* 새 index.html 이 도착했을 때 열려 있는 화면들에 알린다 */
function notifyClients(){
  try{
    self.clients.matchAll({ type:"window" }).then(function(list){
      list.forEach(function(c){ c.postMessage({ qb:"update" }); });
    }).catch(function(){});
  }catch(e){}
}

/* 껍데기가 없을 때 마지막으로 보여줄 화면. 브라우저 오류 페이지보다는 낫다. */
function offlinePage(){
  return new Response(
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>퀘스트 보드</title>' +
    '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
    'background:#0B0F14;color:#E6EDF3;font:15px system-ui,sans-serif;text-align:center">' +
    '<div><p style="font-size:1.1rem;margin:0 0 .5rem">지금 인터넷에 연결되지 않았습니다</p>' +
    '<p style="color:#8A97A8;margin:0 0 1.2rem;font-size:.9rem">' +
    '적어둔 내용은 이 기기에 그대로 있습니다. 연결되면 그대로 열립니다.</p>' +
    '<button onclick="location.reload()" style="background:#E8A33D;border:0;border-radius:.55rem;' +
    'padding:.6rem 1.4rem;font:inherit;font-weight:600;color:#0B0F14;cursor:pointer">다시 시도</button>' +
    '</div></body>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;

  var url;
  try{ url = new URL(req.url); }catch(err){ return; }

  /* ---- 보드 화면: 캐시 먼저 주고, 새 버전은 뒤에서 받아 비교한다 ---- */
  if(req.mode === "navigate"){
    e.respondWith(
      caches.match(SHELL).then(function(hit){
        return hit || caches.match(req, { ignoreSearch:true });
      }).then(function(hit){
        /* navigate 요청 객체를 그대로 fetch 에 다시 쓰면 브라우저가 거부할 수 있다.
           주소만 넘겨 새로 받아온다. */
        var net = fetch(req.url, { cache:"no-store", credentials:"same-origin" });
        if(hit){
          /* 비교용 사본은 hit 을 화면에 넘기기 전에 미리 떠 둔다.
             넘긴 뒤에는 본문이 이미 쓰여서 clone() 이 실패한다. */
          var before = hit.clone();
          e.waitUntil(net.then(function(res){
            if(!res || !res.ok) return;
            var fresh = res.clone();
            putSafe(CACHE, SHELL, res);
            return Promise.all([fresh.text(), before.text()]).then(function(a){
              if(a[0] !== a[1]) notifyClients();     /* 내용이 바뀌었으면 알린다 */
            });
          }).catch(function(){}));
          return hit;                                /* 화면은 즉시 뜬다 */
        }
        return net.then(function(res){
          if(res && res.ok) putSafe(CACHE, SHELL, res);
          return res;
        }).catch(function(){ return offlinePage(); });
      }).catch(function(){ return offlinePage(); })
    );
    return;
  }

  /* ---- 글꼴: 캐시 먼저, 없으면 받아서 담아둔다 (cross-origin 이라 opaque 여도 담는다) ---- */
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(
      caches.match(req).then(function(hit){
        if(hit) return hit;
        return fetch(req).then(function(res){
          if(res) putSafe(FONTS, req, res);
          return res;
        }).catch(function(){
          /* 글꼴이 없어도 화면은 떠야 한다 — 빈 스타일시트를 준다 */
          return new Response("", { headers: { "Content-Type":"text/css" } });
        });
      })
    );
    return;
  }

  /* ---- 그 밖의 파일: 캐시 먼저, 없으면 네트워크 ---- */
  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res && res.status === 200 && res.type === "basic") putSafe(CACHE, req, res);
        return res;
      }).catch(function(){
        return new Response("", { status:504, statusText:"offline" });
      });
    }).catch(function(){
      return new Response("", { status:504, statusText:"offline" });
    })
  );
});
