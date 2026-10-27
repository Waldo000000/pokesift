'use strict';
// Local visual simulation only. Never identifies a card or changes its valuation.
(() => {
  const profiles=Object.fromEntries([
    ['matte','No foil','none','none'],['starlight','Starlight / galaxy','stars','print'],
    ['cosmos','Cosmos circles','cosmos','print'],['sheen','Diagonal sheen','sheen','artwork'],
    ['tinsel','Horizontal tinsel','horizontal','artwork'],['line','Vertical line holo','vertical','artwork'],
    ['water','Water-web holo','water','artwork'],['reverse','Reverse mirror foil','mirror','reverse'],
    ['sparkle','All-over sparkle','stars','full'],['confetti','Pixel / confetti','confetti','artwork'],
    ['sequin','Sequin circles','sequin','artwork'],['cracked-ice','Cracked ice','ice','artwork'],
    ['crosshatch','Crosshatch / radiant grid','crosshatch','reverse'],['textured','Etched full-art texture','etched','full'],
    ['rainbow','Rainbow textured foil','rainbow','full'],['gold','Gold textured foil','gold','full'],
    ['pokeball','Poké Ball pattern','pokeball','reverse'],['masterball','Master Ball pattern','masterball','reverse'],
    ['full-sheen','Full-card sheen','sheen','full'],['fireworks','Fireworks reverse','fireworks','reverse']
  ].map(([id,label,pattern,region])=>[id,{id,label,pattern,region}]));
  const regions={auto:'Use finish default',print:'Mapped artwork background',artwork:'Whole artwork window',reverse:'Card body, excluding artwork',full:'Whole card',subject:'Mapped Pokémon silhouette',border:'Border only','art-border':'Artwork and border',none:'No foil'};
  const layouts={classic:{label:'Classic Pokémon layout',art:[26,40,187,130]},modern:{label:'Modern Pokémon layout',art:[18,46,204,127]},trainer:{label:'Standard Trainer layout',art:[18,42,204,142]},'full-art':{label:'Full-art layout',art:null},energy:{label:'Energy layout',art:null}};
  const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[_–-]+/g,' ').replace(/\s+/g,' ').trim();
  const registry=[
    {id:'base2-4-holo',sets:['base set 2','base2'],number:4,total:130,name:'charizard',profile:'cosmos'},
    {id:'base1-2-holo',sets:['base set','base1'],number:2,total:102,name:'blastoise',profile:'starlight'}
  ];
  function printingFor(data){
    if(data.stamp||!['en','eng','english'].includes(norm(data.language)))return null;
    const number=String(data.number||'').match(/^0*(\d+)(?:\s*\/\s*0*(\d+))?$/);if(!number)return null;
    return registry.find(p=>p.sets.includes(norm(data.set))&&p.number===Number(number[1])&&(!number[2]||p.total===Number(number[2]))&&norm(data.name)===p.name)||null;
  }
  function cleanAppearance(value){
    if(!value||value.version!==1||!Object.hasOwn(profiles,value.profile)||!Object.hasOwn(regions,value.region)||!Object.hasOwn(layouts,value.layout))return null;
    return {version:1,profile:value.profile,region:value.region,layout:value.layout};
  }
  function resolve(data={}){
    const printing=printingFor(data),manual=cleanAppearance(data.appearance);
    const base={profile:'matte',region:'none',layout:'classic',printing:printing?.id||null,source:'unknown',note:'Finish not established. Tilt is available; foil stays off.'};
    if(data.canonical===false)return {...base,note:'Your photo stays unaltered. Foil is available on catalog images.'};
    if(data.game&&!['pokemon','pokémon'].includes(norm(data.game)))return {...base,note:'No foil mapping for this game.'};
    if(manual){const region=manual.region==='auto'?profiles[manual.profile].region:manual.region;return {...base,...manual,region,source:'user',note:'Your visual setting · approximate simulation. It does not change the card’s identification or price.'};}
    const supplied=norm(data.finish),suggested=norm(data.suggestedFinish);
    const finish=['','unknown','unspecified'].includes(supplied)?suggested:supplied;
    if(/^(non ?holo(?: ?foil)?|normal|regular|matte|standard)$/.test(finish))return {...base,source:'metadata',note:'Non-holo finish. No coloured foil.'};
    const holo=/^(holo(?: ?foil)?|holographic(?: ?foil)?|foil)$/.test(finish);
    if(printing&&(!finish||holo))return {...base,profile:printing.profile,region:'print',source:'printing',note:'Printing-specific, hand-drawn mask · approximate '+profiles[printing.profile].label.toLowerCase()+'.'};
    // Exact area and regional variants cannot be recovered from rarity alone.
    // Full-art explicit finish labels are sufficient for a broad visual treatment.
    const full= /full art|full card|all over/.test(finish);
    let profile=null;
    if(full&&/gold/.test(finish))profile='gold';else if(full&&/rainbow/.test(finish))profile='rainbow';
    else if(full&&/textur|etch/.test(finish))profile='textured';else if(full&&/spark|glitter/.test(finish))profile='sparkle';else if(full&&/holo|foil|sheen/.test(finish))profile='full-sheen';
    if(profile)return {...base,profile,region:'full',layout:'full-art',source:'metadata',note:'Full-card finish from saved metadata · approximate simulation.'};
    if(holo){
      const rarity=norm(data.rarity),notes=norm(data.notes);
      // The finish confirms foil; classification refines its coverage. A sleeve
      // description alone is not foil evidence, and rarity alone never enables it.
      const doubleRare=rarity==='double rare'||(/\bdouble rare (?:pok[eé]mon )?ex\b/.test(notes)&&! /\b(?:not|no|uncertain|possibly|maybe)\b[^.]*\bdouble rare\b/.test(notes));
      if(doubleRare)return {...base,profile:'sparkle',region:'full',layout:'modern',source:'metadata',note:'Saved holo finish and double-rare Pokémon ex identification · approximate whole-card sparkle. No exact foil mask is available.'};
      const supertype=norm(data.supertype),set=norm(data.set);
      const layout=supertype==='energy'?'energy':supertype==='trainer'?'trainer':/^(base set(?: 2)?|base[12]|jungle|fossil|team rocket|gym heroes|gym challenge|neo (?:genesis|discovery|revelation|destiny)|legendary collection)$/.test(set)?'classic':'modern';
      return {...base,profile:supertype==='energy'?'full-sheen':'sheen',region:supertype==='energy'?'full':'artwork',layout,source:'metadata',note:'Saved holo finish · diagonal reflection over an approximate '+(supertype==='energy'?'whole-card':'artwork-window')+' area. The exact foil mask is not known; adjust the area if needed.'};
    }
    if(finish)return {...base,note:'Saved finish: '+String(data.finish).slice(0,100)+'. Choose a visual finish and area below; the exact foil map is not known.'};
    return base;
  }
  const silhouettes={
    'base2-4-holo':'M84 52 L99 63 L112 78 L125 86 L134 85 L143 87 L152 92 L160 80 L165 48 L162 41 L175 47 L188 56 L204 65 L211 84 L213 110 L204 99 L193 91 L181 92 L174 101 L178 110 L175 117 L183 130 L190 141 L187 151 L181 155 L185 164 L171 168 L164 161 L150 166 L133 160 L123 166 L113 166 L113 159 L102 154 L89 151 L82 145 L72 146 L69 139 L74 131 L72 123 L80 116 L85 116 L82 123 L86 116 L82 101 L90 96 L90 78 Z',
    'base1-2-holo':'M73 57 L77 51 L92 49 L103 54 L111 49 L116 53 L119 62 L131 73 L142 80 L147 62 L152 56 L160 56 L166 60 L165 69 L161 81 L164 92 L172 103 L170 115 L171 125 L166 141 L163 148 L173 157 L172 163 L161 164 L153 169 L143 168 L137 162 L126 162 L115 164 L105 170 L97 169 L97 164 L84 168 L76 168 L80 158 L89 150 L83 144 L80 131 L73 126 L67 115 L61 110 L61 103 L66 98 L66 92 L72 89 L78 91 L81 91 L78 86 L68 83 L65 74 L66 66 L74 63 Z'
  };

  const maskCache=new Map();
  function maskFor(config){
    if(config.profile==='matte'||config.region==='none')return null;
    const {region,printing}=config,layout=layouts[config.layout];if(!layout)return null;
    if(['print','subject'].includes(region)&&!silhouettes[printing])return null;
    if(['artwork','reverse','art-border'].includes(region)&&!layout.art)return null;
    const key=[region,printing,config.layout].join(':');if(maskCache.has(key))return maskCache.get(key);
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=660;
    const ctx=canvas.getContext('2d');if(!ctx)return null;ctx.scale(2,2);ctx.fillStyle='#fff';
    const outer=()=>{ctx.beginPath();ctx.roundRect(2,2,236,326,9);ctx.fill();};
    const inner=()=>ctx.fillRect(9,9,222,312);
    const border=()=>{outer();ctx.globalCompositeOperation='destination-out';inner();ctx.globalCompositeOperation='source-over';};
    if(region==='full')outer();
    if(region==='border'||region==='art-border')border();
    if(region==='artwork'||region==='art-border')ctx.fillRect(...layout.art);
    if(region==='reverse'){inner();ctx.globalCompositeOperation='destination-out';const [x,y,w,h]=layout.art;ctx.fillRect(x-2,y-2,w+4,h+4);}
    if(region==='print'||region==='subject'){
      const path=new Path2D(silhouettes[printing]);
      if(region==='subject'){ctx.fill(path);ctx.globalCompositeOperation='destination-in';ctx.fillRect(26,40,187,130);}
      else{ctx.fillRect(26,40,187,130);ctx.globalCompositeOperation='destination-out';ctx.fill(path);ctx.lineWidth=3;ctx.lineJoin='round';ctx.stroke(path);ctx.fill(new Path2D('M24 39 L64 39 L44 53 L24 53 Z'));}
    }
    const url=canvas.toDataURL();if(maskCache.size>80)maskCache.clear();maskCache.set(key,url);return url;
  }
  function mount(host,image,initial={}){
    const controller=new AbortController(),signal=controller.signal;
    host.classList.add('foil-card');host.setAttribute('role','button');host.tabIndex=0;
    host.setAttribute('aria-label','Tilt card. Drag or use arrow keys. Home resets the angle.');
    image.draggable=false;image.classList.add('foil-card-image');
    const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;node.setAttribute('aria-hidden','true');host.append(node);return node;};
    const colour=make('span','foil-colour'),canvas=make('canvas','foil-pattern'),beam=make('span','foil-beam'),glare=make('span','foil-gloss');
    canvas.width=480;canvas.height=660;const ctx=canvas.getContext('2d');
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let seed=719;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const flakes=Array.from({length:450},()=>({x:rand()*240,y:rand()*330,r:.3+rand()**3*2.3,nx:rand()*2-1,ny:rand()*2-1,h:rand()*360,a:rand()*Math.PI}));
    let config={},mask=null,rx=0,ry=0,tx=0,ty=0,pointer=null,frame=0,last=0,enabled=true,inspection=false,destroyed=false;
    function pattern(){
      if(!ctx||!mask||!enabled)return;
      ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,240,330);
      const kind=profiles[config.profile].pattern,nx=ry/24,ny=rx/18;
      function ink(x,y,phase=0){const glint=.15+.8*Math.exp(-((x/240-.5-nx*.5)**2+(y/330-.5+ny*.5)**2)*8);const hue=kind==='gold'?45:(x+y+nx*130+ny*90+phase+720)%360;ctx.strokeStyle=ctx.fillStyle=`hsla(${hue},80%,${62+glint*30}%,${glint*.65})`;return glint;}
      if(['stars','cosmos','confetti','sequin','fireworks'].includes(kind))for(const f of flakes){
        const g=Math.exp(-((f.nx-nx*.9)**2+(f.ny+ny*.9)**2)*12),h=(f.h+nx*100+ny*70+720)%360;
        ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.a);ctx.fillStyle=ctx.strokeStyle=`hsla(${h},85%,${65+g*30}%,${.025+g*.75})`;
        const r=kind==='cosmos'||kind==='sequin'?f.r*2:f.r;
        if(kind==='confetti')ctx.fillRect(-r,-r,r*2,r*1.3);
        else if(kind==='stars'||kind==='fireworks'){ctx.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4,s=i%2?r*.22:r*(kind==='fireworks'?3:1.6);ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);}ctx.closePath();ctx.fill();}
        else{ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);if(f.r>1.5){ctx.lineWidth=.5;ctx.stroke();}else ctx.fill();}
        ctx.restore();
      }
      if(['vertical','horizontal','water','crosshatch','etched','rainbow','gold'].includes(kind)){
        ctx.lineWidth=kind==='etched'||kind==='gold'||kind==='rainbow'?.35:.65;
        for(let line=-330;line<570;line+=kind==='etched'||kind==='gold'||kind==='rainbow'?3:7){ink(line%240,(line+330)%330);ctx.beginPath();
          if(kind==='horizontal'){ctx.moveTo(0,line);ctx.lineTo(240,line);}
          else if(kind==='vertical'){ctx.moveTo(line,0);ctx.lineTo(line,330);}
          else if(kind==='water'){for(let y=0;y<=330;y+=4)ctx.lineTo(line+Math.sin(y/13+line/25)*6,y);}
          else if(kind==='crosshatch'){ctx.moveTo(line,0);ctx.lineTo(line+330,330);ctx.moveTo(line,0);ctx.lineTo(line-330,330);}
          else{ctx.ellipse(120,145,Math.abs(line)+2,(Math.abs(line)+2)*1.3,.3,0,Math.PI*2);}
          ctx.stroke();
        }
      }
      if(kind==='ice')for(let y=0;y<330;y+=24)for(let x=-24;x<240;x+=28){ink(x,y);ctx.beginPath();const offset=(y/24)%2*14;ctx.moveTo(x+offset,y);ctx.lineTo(x+offset+28,y+7);ctx.lineTo(x+offset+9,y+29);ctx.closePath();ctx.globalAlpha=.4;ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=.4;ctx.stroke();}
      if(kind==='pokeball'||kind==='masterball')for(let y=12;y<330;y+=28)for(let x=12;x<240;x+=28){ink(x,y);ctx.lineWidth=.75;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.moveTo(x-8,y);ctx.lineTo(x-2,y);ctx.moveTo(x+2,y);ctx.lineTo(x+8,y);ctx.moveTo(x+2,y);ctx.arc(x,y,2,0,Math.PI*2);ctx.stroke();if(kind==='masterball'){ctx.font='bold 6px sans-serif';ctx.textAlign='center';ctx.fillText('M',x,y-3);}}
    }
    function paint(){
      host.style.setProperty('--card-rx',rx+'deg');host.style.setProperty('--card-ry',ry+'deg');
      host.style.setProperty('--light-x',(50+ry*1.7)+'%');host.style.setProperty('--light-y',(40-rx*2)+'%');
      host.style.setProperty('--foil-x',(50+ry*2.7)+'%');host.style.setProperty('--foil-y',(50-rx*3)+'%');
      host.style.setProperty('--foil-angle',(115+ry*.7-rx*.4)+'deg');host.style.setProperty('--gloss',String(.08+(Math.abs(rx)+Math.abs(ry))*.004));pattern();
    }
    function tick(now){if(destroyed)return;const dt=Math.min(40,Math.max(0,now-last));last=now;const a=1-Math.exp(-dt/(pointer?32:125));rx+=(tx-rx)*a;ry+=(ty-ry)*a;paint();if(Math.abs(rx-tx)+Math.abs(ry-ty)>.015)frame=requestAnimationFrame(tick);else{rx=tx;ry=ty;paint();frame=0;}}
    function animate(){if(destroyed)return;if(motion.matches){cancelAnimationFrame(frame);frame=0;rx=tx;ry=ty;paint();}else if(!frame){last=performance.now();frame=requestAnimationFrame(tick);}}
    function reset(){tx=ty=0;animate();}
    host.addEventListener('pointerdown',e=>{if(e.button!==0||pointer)return;e.stopPropagation();pointer={id:e.pointerId,x:e.clientX,y:e.clientY,rx,ry};host.setPointerCapture(e.pointerId);},{signal});
    host.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;const w=host.offsetWidth||240;ty=Math.max(-24,Math.min(24,pointer.ry+(e.clientX-pointer.x)/w*48));tx=Math.max(-18,Math.min(18,pointer.rx-(e.clientY-pointer.y)/w*40));animate();},{signal});
    function release(e){if(!pointer||pointer.id!==e.pointerId)return;pointer=null;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);reset();}
    for(const type of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(type,release,{signal});
    host.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Home')reset();else{ty=Math.max(-24,Math.min(24,ty+({ArrowLeft:-6,ArrowRight:6}[e.key]||0)));tx=Math.max(-18,Math.min(18,tx+({ArrowUp:6,ArrowDown:-6}[e.key]||0)));animate();}},{signal});
    host.addEventListener('blur',()=>{if(!pointer)reset();},{signal});motion.addEventListener('change',animate,{signal});
    function update(next){config={...next};if(!Object.hasOwn(profiles,config.profile))config.profile='matte';mask=maskFor(config);host.dataset.foilProfile=config.profile;host.dataset.foilRegion=config.region;host.dataset.foilSource=config.source||'preview';host.style.setProperty('--foil-mask',mask?`url("${mask}")`:'linear-gradient(transparent,transparent)');host.classList.toggle('has-foil',!!mask&&enabled);paint();}
    update(initial);
    return {update,reset,setEnabled(value){enabled=!!value;host.classList.toggle('has-foil',!!mask&&enabled);paint();},inspect(value){inspection=!!value;host.classList.toggle('inspect-foil',inspection&&!!mask);},get hasMask(){return !!mask;},destroy(){destroyed=true;cancelAnimationFrame(frame);controller.abort();for(const n of [colour,canvas,beam,glare])n.remove();host.classList.remove('foil-card','has-foil','inspect-foil');}};
  }
  window.PokeSiftFoil={profiles,regions,layouts,resolve,cleanAppearance,maskFor,mount};
})();
