/* ============================================================================
   textures.js — every surface in the arcade is drawn procedurally on a canvas.
   No external image files, so the whole floor stays self-contained.
============================================================================ */
import * as THREE from 'three';

/** Japanese-capable font stack. Falls back gracefully on systems without it. */
export const JP = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic',` +
                  `'Noto Sans JP','MS PGothic',sans-serif`;
export const MONO = `ui-monospace,'SF Mono',Menlo,Consolas,monospace`;

const cache = new Map();
/** Memoise by key so repeated fixtures share one GPU texture. */
function memo(key, make){
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function canvas(w, h){
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat=[1,1], srgb=true, aniso=8 } = {}){
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

/* ------------------------------------------------------------------ floor */
/** Glossy dark tile with inlaid colour flecks — reads as arcade vinyl. */
export function floorTexture(repeat = 14){
  return memo('floor'+repeat, () => {
    const S = 512, [c, g] = canvas(S, S);
    g.fillStyle = '#151228'; g.fillRect(0,0,S,S);

    // speckle
    for (let i=0;i<2600;i++){
      const x=Math.random()*S, y=Math.random()*S, r=Math.random()*1.7+0.3;
      g.fillStyle = `rgba(${120+Math.random()*130|0},${110+Math.random()*130|0},${190+Math.random()*65|0},${Math.random()*0.16})`;
      g.beginPath(); g.arc(x,y,r,0,7); g.fill();
    }
    // 4x4 tile grid with grout
    const T = S/4;
    g.strokeStyle = 'rgba(6,4,16,.95)'; g.lineWidth = 4;
    for (let i=0;i<=4;i++){
      g.beginPath(); g.moveTo(i*T,0); g.lineTo(i*T,S); g.stroke();
      g.beginPath(); g.moveTo(0,i*T); g.lineTo(S,i*T); g.stroke();
    }
    // occasional accent tile
    const accents = ['#ff3d8b','#37e6ff','#ffd166'];
    for (let i=0;i<4;i++) for (let j=0;j<4;j++){
      if ((i*4+j) % 7 !== 3) continue;
      g.fillStyle = accents[(i+j)%3];
      g.globalAlpha = 0.13;
      g.fillRect(i*T+6, j*T+6, T-12, T-12);
      g.globalAlpha = 1;
    }
    return toTexture(c, { repeat:[repeat, repeat] });
  });
}

/** Roughness map so the floor has patchy sheen instead of a uniform mirror. */
export function floorRoughness(repeat = 14){
  return memo('floorR'+repeat, () => {
    const S = 256, [c, g] = canvas(S, S);
    g.fillStyle = '#4a4a4a'; g.fillRect(0,0,S,S);
    for (let i=0;i<900;i++){
      const x=Math.random()*S, y=Math.random()*S, r=Math.random()*26+4;
      g.fillStyle = `rgba(255,255,255,${Math.random()*0.10})`;
      g.beginPath(); g.arc(x,y,r,0,7); g.fill();
    }
    const T = S/4;
    g.strokeStyle = 'rgba(190,190,190,.9)'; g.lineWidth = 3;
    for (let i=0;i<=4;i++){
      g.beginPath(); g.moveTo(i*T,0); g.lineTo(i*T,S); g.stroke();
      g.beginPath(); g.moveTo(0,i*T); g.lineTo(S,i*T); g.stroke();
    }
    return toTexture(c, { repeat:[repeat,repeat], srgb:false });
  });
}

/* ------------------------------------------------------------------ walls */
export function wallTexture(repeat = [6, 1]){
  return memo('wall'+repeat.join(), () => {
    const S = 512, [c, g] = canvas(S, S);
    const grd = g.createLinearGradient(0,0,0,S);
    grd.addColorStop(0,'#2a2450'); grd.addColorStop(0.55,'#221d43'); grd.addColorStop(1,'#171331');
    g.fillStyle = grd; g.fillRect(0,0,S,S);
    // vertical panel seams
    g.strokeStyle = 'rgba(0,0,0,.34)'; g.lineWidth = 3;
    for (let i=0;i<=8;i++){ const x=i*S/8; g.beginPath(); g.moveTo(x,0); g.lineTo(x,S); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1.5;
    for (let i=0;i<=8;i++){ const x=i*S/8+3; g.beginPath(); g.moveTo(x,0); g.lineTo(x,S); g.stroke(); }
    // scuff along the skirting
    g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(0, S-52, S, 52);
    return toTexture(c, { repeat });
  });
}

/* --------------------------------------------------------------- ceiling */
/** Fluorescent troffer: bright panel behind a dark egg-crate grille. */
export function trofferTexture(){
  return memo('troffer', () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0,0,256,128);
    g.strokeStyle = 'rgba(60,66,92,.55)'; g.lineWidth = 5;
    for (let i=1;i<8;i++){ g.beginPath(); g.moveTo(i*32,0); g.lineTo(i*32,128); g.stroke(); }
    for (let i=1;i<4;i++){ g.beginPath(); g.moveTo(0,i*32); g.lineTo(256,i*32); g.stroke(); }
    g.strokeStyle = 'rgba(40,44,70,.9)'; g.lineWidth = 8;
    g.strokeRect(4,4,248,120);
    return toTexture(c);
  });
}

export function ceilingTexture(repeat = [10, 7]){
  return memo('ceil'+repeat.join(), () => {
    const S = 256, [c, g] = canvas(S, S);
    g.fillStyle = '#14111f'; g.fillRect(0,0,S,S);
    g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 2;
    for (let i=0;i<=4;i++){
      g.beginPath(); g.moveTo(i*S/4,0); g.lineTo(i*S/4,S); g.stroke();
      g.beginPath(); g.moveTo(0,i*S/4); g.lineTo(S,i*S/4); g.stroke();
    }
    return toTexture(c, { repeat });
  });
}

/* --------------------------------------------------------------- signage */
/** Hanging banner / header sign: bold Japanese headline over a colour wash. */
export function signTexture(jp, en, c1 = '#ff2f7f', c2 = '#37e6ff'){
  return memo(`sign|${jp}|${en}|${c1}|${c2}`, () => {
    const W = 1024, H = 256, [c, g] = canvas(W, H);
    const grd = g.createLinearGradient(0,0,W,H);
    grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = '#0b0720'; g.fillRect(0,0,W,H);
    g.fillStyle = grd; g.fillRect(0,0,W,H);

    // diagonal gloss
    g.globalAlpha = .16; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,H); g.lineTo(W*.55,0); g.lineTo(W*.78,0); g.lineTo(W*.23,H); g.fill();
    g.globalAlpha = 1;

    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 108px ${JP}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,6,26,.85)';
    g.strokeText(jp, W/2, H*0.42);
    g.fillStyle = '#fff'; g.fillText(jp, W/2, H*0.42);

    if (en){
      g.font = `bold 34px ${MONO}`;
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.fillText(en, W/2, H*0.79);
    }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 7; g.strokeRect(4,4,W-8,H-8);
    return toTexture(c);
  });
}

/** Glowing tube-style neon lettering on transparent black. */
export function neonTexture(text, color = '#ff2f7f', sub = ''){
  return memo(`neon|${text}|${color}|${sub}`, () => {
    const W = 1024, H = 256, [c, g] = canvas(W, H);
    g.fillStyle = '#07051a'; g.fillRect(0,0,W,H);
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 120px ${JP}`;
    g.shadowColor = color; g.shadowBlur = 46;
    g.fillStyle = color;  g.fillText(text, W/2, H*(sub?0.40:0.5));
    g.shadowBlur = 22;
    g.fillStyle = '#fff'; g.fillText(text, W/2, H*(sub?0.40:0.5));
    if (sub){
      g.font = `bold 38px ${MONO}`; g.shadowBlur = 20;
      g.fillStyle = '#fff'; g.fillText(sub, W/2, H*0.80);
    }
    return toTexture(c);
  });
}

/** Wall poster — abstract prize art, deliberately non-specific. */
export function posterTexture(seed = 0){
  return memo('poster'+seed, () => {
    const W = 512, H = 720, [c, g] = canvas(W, H);
    const pal = [
      ['#ff5c8a','#ffd166','#2b1a4d'], ['#6ec3ff','#c792ea','#101a3d'],
      ['#7ce38b','#ffd166','#12321f'], ['#ff9f6e','#ff5c8a','#331436'],
      ['#c792ea','#37e6ff','#1a1240'],
    ][seed % 5];
    g.fillStyle = pal[2]; g.fillRect(0,0,W,H);

    // sunburst
    g.save(); g.translate(W/2, H*0.42);
    for (let i=0;i<20;i++){
      g.rotate(Math.PI*2/20);
      g.fillStyle = i%2 ? pal[0] : pal[1];
      g.globalAlpha = .30;
      g.beginPath(); g.moveTo(0,0); g.lineTo(560, -46); g.lineTo(560, 46); g.fill();
    }
    g.restore(); g.globalAlpha = 1;

    // prize blob
    g.fillStyle = pal[0];
    g.beginPath(); g.arc(W/2, H*0.42, 132, 0, 7); g.fill();
    g.fillStyle = pal[1];
    g.beginPath(); g.arc(W/2-46, H*0.36, 30, 0, 7); g.arc(W/2+46, H*0.36, 30, 0, 7); g.fill();
    g.fillStyle = '#1b1430';
    g.beginPath(); g.arc(W/2-40, H*0.42, 13, 0, 7); g.arc(W/2+40, H*0.42, 13, 0, 7); g.fill();

    const heads = ['新登場','大人気','限定','入荷中','景品追加'];
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 82px ${JP}`;
    g.lineWidth = 11; g.strokeStyle = pal[2];
    g.strokeText(heads[seed%5], W/2, H*0.75);
    g.fillStyle = '#fff'; g.fillText(heads[seed%5], W/2, H*0.75);

    g.font = `bold 44px ${MONO}`;
    g.fillStyle = pal[1]; g.fillText('¥100 / 1PLAY', W/2, H*0.87);
    g.strokeStyle = pal[1]; g.lineWidth = 10; g.strokeRect(5,5,W-10,H-10);
    return toTexture(c);
  });
}

/** Price / instruction sticker for the front of a cabinet. */
export function priceTexture(){
  return memo('price', () => {
    const W = 512, H = 256, [c, g] = canvas(W, H);
    g.fillStyle = '#fff'; g.fillRect(0,0,W,H);
    g.fillStyle = '#e2135e'; g.fillRect(0,0,W,74);
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 44px ${JP}`; g.fillStyle = '#fff';
    g.fillText('1プレイ', W/2, 38);
    g.font = `bold 116px ${MONO}`; g.fillStyle = '#151228';
    g.fillText('¥100', W/2, 142);
    g.font = `bold 30px ${JP}`; g.fillStyle = '#6b6b8a';
    g.fillText('３回 ¥２００', W/2, 216);
    return toTexture(c);
  });
}

/** Gachapon front label: capsule art + price, one per colour seed. */
export function gachaLabel(seed = 0){
  return memo('gacha'+seed, () => {
    const W = 256, H = 256, [c, g] = canvas(W, H);
    const pal = ['#ff5c8a','#ffd166','#7ce38b','#6ec3ff','#c792ea','#ff9f6e'][seed % 6];
    g.fillStyle = '#fdfbf4'; g.fillRect(0,0,W,H);
    g.fillStyle = pal; g.fillRect(0,0,W,88);
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 40px ${JP}`; g.fillStyle = '#2a1a30';
    g.fillText(['ミニフィギュア','キーホルダー','ぬいぐるみ','カプセル'][seed%4], W/2, 44);
    // capsule graphic
    g.fillStyle = pal;   g.beginPath(); g.arc(W/2, 150, 42, Math.PI, 0); g.fill();
    g.fillStyle = '#fff';g.beginPath(); g.arc(W/2, 150, 42, 0, Math.PI); g.fill();
    g.strokeStyle='#2a1a30'; g.lineWidth=5; g.beginPath(); g.arc(W/2,150,42,0,7); g.stroke();
    g.font = `bold 46px ${MONO}`; g.fillStyle = '#e2135e';
    g.fillText('¥300', W/2, 224);
    return toTexture(c);
  });
}

/** Night street seen through the entrance glass. */
export function streetTexture(){
  return memo('street', () => {
    const W = 1024, H = 512, [c, g] = canvas(W, H);
    const sky = g.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#0a0a22'); sky.addColorStop(.55,'#1a1038'); sky.addColorStop(1,'#2a1330');
    g.fillStyle = sky; g.fillRect(0,0,W,H);
    // far buildings
    for (let i=0;i<26;i++){
      const w = 30+Math.random()*70, h = 90+Math.random()*230, x = Math.random()*W;
      g.fillStyle = `rgba(${20+Math.random()*30|0},${16+Math.random()*24|0},${50+Math.random()*40|0},1)`;
      g.fillRect(x, H-h-70, w, h);
      for (let k=0;k<26;k++){
        if (Math.random()<0.45) continue;
        g.fillStyle = `rgba(255,${190+Math.random()*60|0},${120+Math.random()*90|0},${.35+Math.random()*.5})`;
        g.fillRect(x+4+Math.random()*(w-10), H-h-64+Math.random()*(h-14), 4, 6);
      }
    }
    // neon signs + wet road glow
    const cols = ['#ff2f7f','#37e6ff','#ffd166','#c792ea'];
    for (let i=0;i<16;i++){
      const x=Math.random()*W, y=H-120-Math.random()*180;
      g.fillStyle = cols[i%4]; g.globalAlpha = .55;
      g.fillRect(x, y, 8+Math.random()*70, 12+Math.random()*44);
      g.globalAlpha = 1;
    }
    const road = g.createLinearGradient(0,H-80,0,H);
    road.addColorStop(0,'rgba(255,90,150,.32)'); road.addColorStop(1,'rgba(10,6,26,1)');
    g.fillStyle = road; g.fillRect(0,H-80,W,80);
    return toTexture(c);
  });
}

/** Soft radial blob used as a fake contact shadow under fixtures. */
export function blobTexture(){
  return memo('blob', () => {
    const S = 128, [c, g] = canvas(S, S);
    const grd = g.createRadialGradient(S/2,S/2,0, S/2,S/2,S/2);
    grd.addColorStop(0,  'rgba(0,0,0,.62)');
    grd.addColorStop(.55,'rgba(0,0,0,.28)');
    grd.addColorStop(1,  'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0,0,S,S);
    return toTexture(c, { srgb:false });
  });
}

/** Small white-on-dark label, used for the bay-debug overlay. */
export function labelTexture(text, color = '#37e6ff'){
  return memo('label'+text+color, () => {
    const W = 256, H = 128, [c, g] = canvas(W, H);
    g.fillStyle = 'rgba(6,4,18,.88)';
    g.beginPath(); g.roundRect(4,4,W-8,H-8,16); g.fill();
    g.strokeStyle = color; g.lineWidth = 4;
    g.beginPath(); g.roundRect(4,4,W-8,H-8,16); g.stroke();
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 58px ${MONO}`; g.fillStyle = color;
    g.fillText(text, W/2, H/2+2);
    return toTexture(c);
  });
}
