// ─── Storage keys ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'calcEvokerState2';
const AUTH_KEY    = 'calcEvokerAuth';

// ─── Sync server address ──────────────────────────────────────────────────────
const API_URL = 'https://gbf.keka312.com';

// ─── Runtime shim: same file runs as an extension page or a plain website ─────
const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.runtime?.getURL;

const storage = IS_EXTENSION ? chrome.storage.local : {
  get(keys, cb) {
    const result = {};
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw !== null) { try { result[key] = JSON.parse(raw); } catch (e) { } }
    }
    Promise.resolve().then(() => cb(result));
  },
  set(obj) {
    for (const [key, value] of Object.entries(obj)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },
};

function assetUrl(path) {
  return IS_EXTENSION ? chrome.runtime.getURL(path) : path;
}

// ─── Item catalogue (mirrored from supplies.js) ───────────────────────────────
const ITEMS = {
  rupie:'Rupie', crystal:'Crystal', blueskycristal:'Blue Sky Crystal',
  satinfeather:'Satin Feather', untamedflame:'Untamed Flame', roughstone:'Rough Stone',
  freshwaterjug:'Fresh Water Jug', vermilionstone:'Vermilion Stone',
  hollowsoul:'Hollow Soul', zephyrfeather:'Zephyr Feather', falconfeather:'Falcon Feather',
  forebodingclover:'Foreboding Clover', swirlingamber:'Swirling Amber',
  lacrimosa:'Lacrimosa', bloodamber:'Blood Amber', antiquecloth:'Antique Cloth',
  goldbrick:'Gold Brick', damascuscrystal:'Damascus Crystal',
  brightspirits:'Bright Spirits', murkyspirits:'Murky Spirits',
  blueskyspirit:'Blue-Sky Spirit', truedragonsgoldenscale:"True Dragon's Golden Scale",
  tearsoftheapocalypse:'Tears of the Apocalypse', abyssalwing:'Abyssal Wing',
  cunningdevilshorn:"Cunning Devil's Horn", eternitysand:'Eternity Sand',
  flawlessprism:'Flawless Prism', flawedprism:'Flawed Prism',
  rainbowprism:'Rainbow Prism', championmerit:'Champion Merit',
  suprememerit:'Supreme Merit', legendarymerit:'Legendary Merit',
  lapismerit:'Lapis Merit', silvercentrum:'Silver Centrum',
  sunlightstone:'Sunlight Stone', genesisfragment:'Genesis Fragment',
  primevalhorn:'Primeval Horn', malicefragment:'Malice Fragment',
  verdantazurite:'Verdant Azurite', sephirastone:'Sephira Stone',
  sephiraevolite:'Sephira Evolite', newworldquartz:'New World Quartz',
  reddragonscale:'Red Dragon Scale', bluedragonscale:'Blue Dragon Scale',
  browndragonscale:'Brown Dragon Scale', greendragonscale:'Green Dragon Scale',
  whitedragonscale:'White Dragon Scale', blackdragonscale:'Black Dragon Scale',
  orbfire:'Inferno Orb', orbwater:'Frost Orb', orbearth:'Rumbling Orb',
  orbwind:'Cyclone Orb', orblight:'Shining Orb', orbdark:'Abysm Orb',
  loworbfire:'Fire Orb', loworbwater:'Water Orb', loworbearth:'Earth Orb',
  loworbwind:'Wind Orb', loworblight:'Light Orb', loworbdark:'Dark Orb',
  loworb:'Low Orb',
  scrollfire:'Hellfire Scroll', scrollwater:'Flood Scroll', scrollearth:'Thunder Scroll',
  scrollwind:'Gale Scroll', scrolllight:'Skylight Scroll', scrolldark:'Chasm Scroll',
  tomefire:'Red Tome', tomewater:'Blue Tome', tomeearth:'Brown Tome',
  tomewind:'Green Tome', tomelight:'White Tome', tomedark:'Black Tome',
  firegrimoire:'Fire Grimoire', watergrimoire:'Water Grimoire',
  earthgrimoire:'Earth Grimoire', windgrimoire:'Wind Grimoire',
  trueanimafire:'True Fire Anima', trueanimawater:'True Water Anima',
  trueanimaearth:'True Earth Anima', trueanimawind:'True Wind Anima',
  trueanimalight:'True Light Anima', trueanimadark:'True Dark Anima',
  trueanima:'True Anima',
  whorlfire:'Infernal Whorl', whorlwater:'Tidal Whorl', whorlearth:'Seismic Whorl',
  whorlwind:'Tempest Whorl', whorllight:'Radiant Whorl', whorldark:'Umbral Whorl',
  whorl:'Whorl',
  rubeuscentrum:'Rubeus Centrum', indicuscentrum:'Indicus Centrum',
  luteuscentrum:'Luteus Centrum', galbinuscentrum:'Galbinus Centrum',
  niveuscentrum:'Niveus Centrum', atercentrum:'Ater Centrum',
  toxictulip:'Toxic Tulip', bestiafruit:'Bestia Fruit',
  jumbobeastbone:'Jumbo Beast Bone', klugerherb:'Kluger Herb',
  rhempepper:'Rhem Pepper', brokenteacup:'Broken Teacup',
  rustyeave:'Rusty Eave', translucentsilk:'Translucent Silk',
  meditativesutra:'Meditative Sutra', dustybook:'Dusty Book',
  infernalgarnet:'Infernal Garnet', frozenhellprism:'Frozen Hell Prism',
  eviljudgecrystal:'Evil Judge Crystal', horsemansplate:"Horseman's Plate",
  halolightquartz:'Halo Light Quartz', phantomdemonjewel:'Phantom Demon Jewel',
  guardiandistinction:'Guardian Distinction',
  sharpshooterdistinction:'Sharpshooter Distinction',
  gladiatordistinction:'Gladiator Distinction',
  fencerdistinction:'Fencer Distinction', pilgrimdistinction:'Pilgrim Distinction',
  combatantdistinction:'Combatant Distinction',
  swordmasterdistinction:'Sword Master Distinction',
  samuraidistinction:'Samurai Distinction',
  troubadourdistinction:'Troubadour Distinction',
  banditdistinction:'Bandit Distinction',
  firequartz:'Fire Quartz', waterquartz:'Water Quartz', earthquartz:'Earth Quartz',
  windquartz:'Wind Quartz', lightquartz:'Light Quartz', darkquartz:'Dark Quartz',
  hellfirefragment:'Hellfire Fragment', delugefragment:'Deluge Fragment',
  wastelandfragment:'Wasteland Fragment', typhoonfragment:'Typhoon Fragment',
  fireurn:'Fire Urn', waterurn:'Water Urn', earthurn:'Earth Urn',
  windurn:'Wind Urn', lighturn:'Light Urn', darkurn:'Dark Urn',
  flameborneastra:'Flameborne Astra', aquaborneastra:'Aquaborne Astra',
  earthborneastra:'Earthborne Astra', windborneastra:'Windborne Astra',
  lightborneastra:'Lightborne Astra', darkborneastra:'Darkborne Astra',
  justiceidean:'Justice Idean', hangedmanidean:'Hanged Man Idean',
  deathidean:'Death Idean', temperanceidean:'Temperance Idean',
  devilidean:'Devil Idean', toweridean:'Tower Idean',
  staridean:'Star Idean', moonidean:'Moon Idean',
  sunidean:'Sun Idean', judgementidean:'Judgement Idean',
  worldidean:'World Idean',
  justiceveritas:'Justice Veritas', hangedmanveritas:'Hanged Man Veritas',
  deathveritas:'Death Veritas', temperanceveritas:'Temperance Veritas',
  devilveritas:'Devil Veritas', towerveritas:'Tower Veritas',
  starveritas:'Star Veritas', moonveritas:'Moon Veritas',
  sunveritas:'Sun Veritas', judgementveritas:'Judgement Veritas',
  fireverum:'Fire Verum Proof', waterverum:'Water Verum Proof',
  earthverum:'Earth Verum Proof', windverum:'Wind Verum Proof',
  fireluster:'Ignis Luster', waterluster:'Aqua Luster',
  earthluster:'Terra Luster', windluster:'Ventus Luster',
  aurorahaze:'Aurora Haze', chaotichaze:'Chaotic Haze',
  aquilafragment:'Aquila Fragment', bellatorfragment:'Bellator Fragment',
  celsusfragment:'Celsus Fragment',
  gospelofgenea:'Gospel of Genea', gospelofegeiro:'Gospel of Egeiro',
  gospelofthysia:'Gospel of Thysia', gospelofanalipsis:'Gospel of Analipsis',
  animafire:'Colossus Anima', animawater:'Leviathan Anima',
  animaearth:'Yggdrasil Anima', animawind:'Tiamat Anima',
  animalight:'Luminiera Anima', animadark:'Celeste Anima',
  fireomegaanima:'Colossus Omega Anima', wateromegaanima:'Leviathan Omega Anima',
  earthomegaanima:'Yggdrasil Omega Anima', windomegaanima:'Tiamat Omega Anima',
  lightomegaanima:'Luminiera Omega Anima', darkomegaanima:'Celeste Omega Anima',
  allotropicagate:'Allotropic Agate',
  wheelwater:'Wheel of Aqua', wheelearth:'Wheel of Terra',
  fellcorefire:'Belmervolk Fellcore', fellcorewater:'Nihuyvintae Fellcore',
  fellcoreearth:'Narophirmidas Fellcore', fellcorewind:'Macutanmacar Fellcore',
  fellcorelight:'Papahlukruva Fellcore', fellcoredark:'Zamalvoch Fellcore',
  beliefjustice:'Belief in Justice', beliefhangedman:'Belief in The Hanged Man',
  fireomega2omegaanima:'Shiva Omega Anima',
  wateromega2omegaanima:'Europa Omega Anima',
  earthomega2omegaanima:'Alexiel Omega Anima',
  windomega2omegaanima:'Grimnir Omega Anima',
  lightomega2omegaanima:'Metatron Omega Anima',
  darkomega2omegaanima:'Avatar Omega Anima',
  firesixdragon:'Smoldering Rubble', watersixdragon:'Abyssal Tragedy',
  earthsixdragon:'Insular Core', windsixdragon:'Gale Rock',
  lightsixdragon:'Thunderbolt Wheel', darksixdragon:'Todestrieb',
  firesixdragonjewel:"Wilnas's Jewel", watersixdragonjewel:"Wamdus's Jewel",
  earthsixdragonjewel:"Galleon's Jewel", windsixdragonjewel:"Ewiyar's Jewel",
  lightsixdragonjewel:"Lu Woh's Jewel", darksixdragonjewel:"Fediel's Jewel",
  firet1anima:'Twin Elements Anima', watert1anima:'Macula Marius Anima',
  eartht1anima:'Medusa Anima', windt1anima:'Nezha Anima',
  lightt1anima:'Apollo Anima', darkt1anima:'Dark Angel Olivia Anima',
  firet2anima:'Athena Anima', watert2anima:'Grani Anima',
  eartht2anima:'Baal Anima', windt2anima:'Garuda Anima',
  lightt2anima:'Odin Anima', darkt2anima:'Lich Anima',
  michaelanima:'Michael Anima', gabrielanima:'Gabriel Anima',
  urielanima:'Uriel Anima', raphaelanima:'Raphael Anima',
  halofire:'Fire Halo', halowater:'Water Halo',
  haloearth:'Earth Halo', halowind:'Wind Halo',
  huanglongomegaanima:'Huanglong Omega Anima',
  qilinomegaanima:'Qilin Omega Anima',
  // Animated items
  loworb_gif: 'Low Orb', trueanima_gif: 'True Anima', whorl_gif: 'Whorl',
};

const ANIMATED = new Set(['loworb','trueanima','whorl','rustedweapon']);

// Categories
const CAT = { quest: 100, coop: 200, anima: 300, arcarum: 400 };

// ─── Group resolvers (mirrored from supplies.js) ──────────────────────────────
const GROUPS = {
  quartz:   { type:'element', cat: CAT.quest, fire:'firequartz', water:'waterquartz', earth:'earthquartz', wind:'windquartz', light:'lightquartz', dark:'darkquartz' },
  trialfragment: { type:'element', cat: CAT.quest, fire:'hellfirefragment', water:'delugefragment', earth:'wastelandfragment', wind:'typhoonfragment', light:['hellfirefragment','typhoonfragment'], dark:['delugefragment','wastelandfragment'] },
  dragonscale: { type:'element', cat: CAT.quest, fire:'reddragonscale', water:'bluedragonscale', earth:'browndragonscale', wind:'greendragonscale', light:'whitedragonscale', dark:'blackdragonscale' },
  urns:     { type:'element', cat: CAT.quest, fire:'fireurn', water:'waterurn', earth:'earthurn', wind:'windurn', light:'lighturn', dark:'darkurn' },
  coopshowdownitem: { type:'element', cat: CAT.coop, fire:'infernalgarnet', water:'frozenhellprism', earth:'eviljudgecrystal', wind:'horsemansplate', light:'halolightquartz', dark:'phantomdemonjewel' },
  astra:    { type:'element', cat: CAT.arcarum, fire:'flameborneastra', water:'aquaborneastra', earth:'earthborneastra', wind:'windborneastra', light:'lightborneastra', dark:'darkborneastra' },
  idean:    { type:'summon', cat: CAT.arcarum, 2040236:'justiceidean', 2040237:'hangedmanidean', 2040238:'deathidean', 2040239:'temperanceidean', 2040240:'devilidean', 2040241:'toweridean', 2040242:'staridean', 2040243:'moonidean', 2040244:'sunidean', 2040245:'judgementidean' },
  veritas:  { type:'summon', cat: CAT.arcarum, 2040236:'justiceveritas', 2040237:'hangedmanveritas', 2040238:'deathveritas', 2040239:'temperanceveritas', 2040240:'devilveritas', 2040241:'towerveritas', 2040242:'starveritas', 2040243:'moonveritas', 2040244:'sunveritas', 2040245:'judgementveritas' },
  verum:    { type:'element', cat: CAT.arcarum, fire:'fireverum', water:'waterverum', earth:'earthverum', wind:'windverum', light:['fireverum','windverum'], dark:['waterverum','earthverum'] },
  luster:   { type:'element', cat: CAT.arcarum, fire:'fireluster', water:'waterluster', earth:'earthluster', wind:'windluster', light:['fireluster','windluster'], dark:['waterluster','earthluster'] },
  gospel:   { type:'element', cat: CAT.arcarum, fire:'gospelofegeiro', water:'gospelofanalipsis', earth:'gospelofthysia', wind:'gospelofgenea', light:['gospelofgenea','gospelofegeiro'], dark:['gospelofanalipsis','gospelofthysia'] },
  haze:     { type:'element', cat: CAT.arcarum, fire:'aurorahaze', water:'chaotichaze', earth:'chaotichaze', wind:'aurorahaze', light:'aurorahaze', dark:'chaotichaze' },
  arcarumfragment: { type:'summon', cat: CAT.arcarum, 2040236:'bellatorfragment', 2040237:'aquilafragment', 2040238:'celsusfragment', 2040239:'celsusfragment', 2040240:'aquilafragment', 2040241:'celsusfragment', 2040242:'celsusfragment', 2040243:'bellatorfragment', 2040244:'aquilafragment', 2040245:'bellatorfragment' },
  arcarumssr5treasure: { type:'summon', cat: CAT.arcarum, 2040236:'toxictulip', 2040237:'bestiafruit', 2040238:'jumbobeastbone', 2040239:'klugerherb', 2040240:'rhempepper', 2040241:'brokenteacup', 2040242:'rustyeave', 2040243:'translucentsilk', 2040244:'meditativesutra', 2040245:'dustybook' },
  anima:    { type:'element', cat: CAT.anima, fire:'animafire', water:'animawater', earth:'animaearth', wind:'animawind', light:'animalight', dark:'animadark' },
  omegaanima: { type:'element', cat: CAT.anima, fire:'fireomegaanima', water:'wateromegaanima', earth:'earthomegaanima', wind:'windomegaanima', light:'lightomegaanima', dark:'darkomegaanima' },
  omega2omegaanima: { type:'element', cat: CAT.anima, fire:'fireomega2omegaanima', water:'wateromega2omegaanima', earth:'earthomega2omegaanima', wind:'windomega2omegaanima', light:'lightomega2omegaanima', dark:'darkomega2omegaanima' },
  sixdragon: { type:'element', cat: CAT.anima, fire:'firesixdragon', water:'watersixdragon', earth:'earthsixdragon', wind:'windsixdragon', light:'lightsixdragon', dark:'darksixdragon' },
  sixdragonjewel: { type:'element', cat: CAT.anima, fire:'firesixdragonjewel', water:'watersixdragonjewel', earth:'earthsixdragonjewel', wind:'windsixdragonjewel', light:'lightsixdragonjewel', dark:'darksixdragonjewel' },
  t1anima:  { type:'element', cat: CAT.anima, fire:'firet1anima', water:'watert1anima', earth:'eartht1anima', wind:'windt1anima', light:'lightt1anima', dark:'darkt1anima' },
  t2anima:  { type:'element', cat: CAT.anima, fire:'firet2anima', water:'watert2anima', earth:'eartht2anima', wind:'windt2anima', light:'lightt2anima', dark:'darkt2anima' },
  primarchanima: { type:'element', cat: CAT.anima, fire:'michaelanima', water:'gabrielanima', earth:'urielanima', wind:'raphaelanima', light:['michaelanima','raphaelanima'], dark:['gabrielanima','urielanima'] },
  halos:    { type:'element', cat: CAT.anima, fire:'halofire', water:'halowater', earth:'haloearth', wind:'halowind', light:['halofire','halowind'], dark:['halowater','haloearth'] },
  wheel:    { type:'element', cat: CAT.arcarum, water:'wheelwater', earth:'wheelearth' },
  fellcore: { type:'element', cat: CAT.arcarum, fire:'fellcorefire', water:'fellcorewater', earth:'fellcoreearth', wind:'fellcorewind', light:'fellcorelight', dark:'fellcoredark' },
  belief:   { type:'summon', cat: CAT.arcarum, 2040236:'beliefjustice', 2040237:'beliefhangedman' },
};

// Item Info for sorting and metadata
const ITEMS_INFO = {
  'sephirastone': { cat: CAT.arcarum },
  'sephiraevolite': { cat: CAT.arcarum },
  'newworldquartz': { cat: CAT.arcarum },
  'eternitysand': { cat: CAT.quest },
  'damascuscrystal': { cat: CAT.quest },
  'sunlightstone': { cat: CAT.quest },
  'flawlessprism': { cat: CAT.quest },
  'rainbowprism': { cat: CAT.quest },
  'legendarymerit': { cat: CAT.quest },
  'suprememerit': { cat: CAT.quest },
  'silvercentrum': { cat: CAT.quest },
  'genesisfragment': { cat: CAT.quest },
  'primevalhorn': { cat: CAT.quest },
  'malicefragment': { cat: CAT.quest },
  'verdantazurite': { cat: CAT.quest },
  'rupie': { cat: CAT.quest },
  'worldidean': { cat: CAT.arcarum },
  'allotropicagate': { cat: CAT.arcarum },
};

// ─── Evoker data ───────────────────────────────────────────────────────────────
const UNITS = {
  2040236: { name:'Justice - Maria Theresa',    element:'water' },
  2040237: { name:'The Hanged Man - Caim',       element:'earth' },
  2040238: { name:'Death - Nier',                element:'dark'  },
  2040239: { name:'Temperance - Estarriola',     element:'wind'  },
  2040240: { name:'The Devil - Fraux',           element:'fire'  },
  2040241: { name:'The Tower - Lobelia',         element:'earth' },
  2040242: { name:'The Star - Geisenborger',     element:'light' },
  2040243: { name:'The Moon - Haaselia',         element:'water' },
  2040244: { name:'The Sun - Alanaan',           element:'fire'  },
  2040245: { name:'Judgement - Katzelia',        element:'wind'  },
};

const MATERIALS = [
  { name:'SR Summon 0*',                  items:[{item:'sephirastone',q:2},{item:'flawlessprism',q:100},{group:'astra',q:3},{group:'idean',q:2},{group:'verum',q:6},{group:'omegaanima',q:30},{group:'haze',q:1}] },
  { name:'SR Summon 1*',                  items:[{item:'sephirastone',q:5},{item:'rainbowprism',q:100},{group:'astra',q:5},{group:'idean',q:3},{group:'verum',q:16},{group:'quartz',q:100},{group:'haze',q:3}] },
  { name:'SR Summon 2*',                  items:[{item:'sephirastone',q:10},{group:'astra',q:10},{group:'idean',q:5},{group:'verum',q:30},{group:'t1anima',q:30},{group:'haze',q:7}] },
  { name:'SR Summon 3*',                  items:[{item:'sephirastone',q:15},{item:'legendarymerit',q:3},{group:'astra',q:15},{group:'idean',q:7},{group:'verum',q:50},{group:'t2anima',q:30},{group:'haze',q:16}] },
  { name:'Upgrade Summon to SSR',         items:[{item:'sephirastone',q:30},{item:'silvercentrum',q:5},{item:'sunlightstone',q:1},{group:'astra',q:30},{group:'idean',q:15},{group:'verum',q:80},{group:'primarchanima',q:20},{group:'haze',q:24}] },
  { name:'SSR Summon 4*',                 items:[{item:'sephirastone',q:45},{group:'astra',q:45},{group:'idean',q:25},{group:'verum',q:120},{group:'haze',q:32},{group:'omega2omegaanima',q:10},{group:'arcarumfragment',q:10}] },
  { name:'SSR Summon 5*',                 items:[{group:'coopshowdownitem',q:100},{group:'trialfragment',q:50},{group:'verum',q:250},{group:'arcarumssr5treasure',q:50},{item:'genesisfragment',q:80},{item:'primevalhorn',q:10},{group:'arcarumfragment',q:20}] },
  { name:'Recruit Evoker',                items:[{group:'idean',q:20},{group:'astra',q:200},{item:'sephirastone',q:30},{item:'sephiraevolite',q:1}] },
  { name:'Uncap Evoker 1*',              items:[{group:'verum',q:2},{item:'flawlessprism',q:5},{item:'suprememerit',q:1},{item:'rupie',q:1000}] },
  { name:'Uncap Evoker 2*',              items:[{group:'astra',q:1},{group:'verum',q:2},{item:'flawlessprism',q:10},{group:'dragonscale',q:1},{item:'suprememerit',q:3},{item:'rupie',q:2000}] },
  { name:'Uncap Evoker 3*',              items:[{group:'astra',q:2},{group:'verum',q:6},{item:'rainbowprism',q:3},{group:'idean',q:1},{item:'suprememerit',q:6},{item:'rupie',q:4000}] },
  { name:'Uncap Evoker 4*',              items:[{group:'astra',q:3},{group:'verum',q:10},{group:'haze',q:3},{group:'idean',q:1},{item:'suprememerit',q:10},{item:'rupie',q:20000}] },
  { name:'1st Domain Bonus',             items:[{item:'genesisfragment',q:30},{group:'verum',q:120},{item:'sephirastone',q:5},{group:'haze',q:20}] },
  { name:'Buy New World Foundation Weapon', items:[{item:'newworldquartz',q:5},{group:'luster',q:5},{group:'veritas',q:20}] },
  { name:'Uncap Weapon 1*',              items:[{item:'newworldquartz',q:5},{group:'luster',q:15},{group:'veritas',q:70},{item:'malicefragment',q:30},{group:'verum',q:100},{group:'astra',q:30}] },
  { name:'2nd Domain Bonus',             items:[{group:'urns',q:30},{group:'verum',q:240},{group:'astra',q:30},{group:'haze',q:30},{item:'sephirastone',q:10}] },
  { name:'Uncap Weapon 2*',              items:[{item:'newworldquartz',q:10},{group:'luster',q:30},{group:'veritas',q:100},{item:'verdantazurite',q:20},{group:'verum',q:150},{group:'astra',q:50},{group:'idean',q:30}] },
  { name:'3rd Domain Bonus',             items:[{group:'omega2omegaanima',q:10},{group:'veritas',q:30},{group:'astra',q:40},{group:'idean',q:40},{group:'arcarumfragment',q:10},{item:'sephirastone',q:15}] },
  { name:'Uncap Weapon 3*',              items:[{item:'newworldquartz',q:20},{group:'luster',q:50},{group:'veritas',q:130},{group:'sixdragonjewel',q:20},{group:'verum',q:200},{group:'astra',q:100},{group:'idean',q:70}] },
  { name:'4th Domain Bonus and Support Skill', items:[{group:'sixdragon',q:30},{group:'luster',q:20},{group:'veritas',q:50},{group:'astra',q:40},{group:'idean',q:70},{group:'arcarumfragment',q:20},{item:'sephirastone',q:20}] },
  { name:'Uncap Weapon 4*',              items:[{item:'newworldquartz',q:20},{group:'veritas',q:150},{group:'verum',q:250},{group:'idean',q:100},{group:'luster',q:60},{group:'sixdragonjewel',q:30},{group:'astra',q:120}] },
  { name:'Uncap Weapon 5*',              items:[{item:'newworldquartz',q:30},{group:'luster',q:70},{group:'veritas',q:170},{group:'sixdragon',q:30},{group:'arcarumfragment',q:30},{group:'astra',q:140},{group:'idean',q:130},{item:'eternitysand',q:3}] },
  { name:'Uncap Evoker 5*',             items:[{item:'sephiraevolite',q:1},{group:'gospel',q:50},{group:'luster',q:50},{item:'sephirastone',q:200},{item:'rupie',q:100000}] },
  { name:'Unlock 4th skill',             items:[{item:'sunlightstone',q:1},{item:'worldidean',q:100},{item:'newworldquartz',q:30},{item:'damascuscrystal',q:10}] },
  { name:'Evoker Transcendence Stage 1 (6*)', items:[{group:'belief',q:40},{group:'wheel',q:8},{item:'allotropicagate',q:1},{item:'newworldquartz',q:20},{group:'fellcore',q:60},{group:'idean',q:120},{group:'astra',q:240},{item:'rupie',q:100000}] },
];

// ─── Application state ────────────────────────────────────────────────────────
const state = {
  // { unitKey: { from: -1, to: lastIdx, fold: false, materials: [{itemKey: owned, ...}, ...] } }
  progress: {},
  splitMats: true,
  hideCompleted: false,
  displayMode: 0,   // 0=grid, 1=list
  username: '',
  password: '',
  token: '',
};

// ─── Group resolution ─────────────────────────────────────────────────────────
/**
 * Resolve a group/item spec to an array of { itemKey, max } for a given unit.
 * When a group has multiple items (array), the quantity is split evenly.
 */
function resolveItemSpec(spec, unitKey) {
  const unit = UNITS[unitKey];
  const element = unit ? unit.element : 'fire';

  let refs;
  let category = CAT.quest;
  if (spec.item) {
    refs = [spec.item];
    category = ITEMS_INFO[spec.item]?.cat || CAT.quest;
  } else {
    const g = GROUPS[spec.group];
    if (!g) { console.warn('Unknown group:', spec.group); return []; }
    category = g.cat || CAT.quest;
    if (g.type === 'element') {
      refs = g[element];
    } else {
      refs = g[unitKey] || g[String(unitKey)];
    }
    if (!refs) { console.warn('No mapping for group', spec.group, 'unit', unitKey); return []; }
    if (!Array.isArray(refs)) refs = [refs];
  }

  return refs.map((itemKey) => {
    const divided = spec.q / refs.length;
    let max;
    if (Number.isInteger(divided)) {
      max = divided;
    } else {
      max = divided < 5 ? Math.ceil(divided) : Math.floor(divided);
    }
    return { itemKey, max, category };
  });
}

// ─── Image resolution ─────────────────────────────────────────────────────────
function imgUrl(key, ext) {
  return assetUrl(`assets/items/${key}.${ext}`);
}

function buildImgCandidates(itemKey) {
  const animated = ANIMATED.has(itemKey);
  const urls = [];
  if (animated) {
    urls.push(imgUrl(itemKey, 'gif'));
  }
  urls.push(imgUrl(itemKey, 'jpg'));
  urls.push(imgUrl(itemKey, 'png'));
  urls.push(imgUrl(itemKey, 'webp'));
  urls.push(imgUrl(itemKey, 'jpeg'));
  return urls;
}

function createImgEl(itemKey, size) {
  const candidates = buildImgCandidates(itemKey);
  const img = document.createElement('img');
  img.src = candidates[0];
  img.alt = ITEMS[itemKey] || itemKey;
  img.width = size; img.height = size;
  img.dataset.candidates = JSON.stringify(candidates);
  img.dataset.candidateIdx = '0';
  img.addEventListener('error', function onErr() {
    let list;
    try { list = JSON.parse(img.dataset.candidates || '[]'); } catch(e) { list = []; }
    const nextIdx = Number(img.dataset.candidateIdx || 0) + 1;
    if (nextIdx < list.length) {
      img.dataset.candidateIdx = String(nextIdx);
      img.src = list[nextIdx];
      return;
    }
    // All candidates exhausted — show placeholder
    const ph = document.createElement('div');
    ph.className = 'img-placeholder';
    ph.textContent = '🧱';
    img.replaceWith(ph);
  });
  return img;
}

// ─── Progress helpers ─────────────────────────────────────────────────────────
function ensureProgress(unitKey) {
  if (!state.progress[unitKey]) {
    state.progress[unitKey] = {
      from: -1,
      to: MATERIALS.length - 1,
      fold: false,
      materials: Array.from({ length: MATERIALS.length }, () => ({})),
    };
  }
  // Extend if steps were added
  while (state.progress[unitKey].materials.length < MATERIALS.length) {
    state.progress[unitKey].materials.push({});
  }
}

function getOwned(unitKey, stepIdx, itemKey) {
  ensureProgress(unitKey);
  return Number(state.progress[unitKey].materials[stepIdx]?.[itemKey] || 0);
}

function setOwned(unitKey, stepIdx, itemKey, val) {
  ensureProgress(unitKey);
  if (!state.progress[unitKey].materials[stepIdx]) state.progress[unitKey].materials[stepIdx] = {};
  state.progress[unitKey].materials[stepIdx][itemKey] = Math.max(0, val);
}

function setOwnedDistributed(unitKey, itemKey, totalVal) {
  ensureProgress(unitKey);
  const p = state.progress[unitKey];
  const start = p.from !== -1 ? p.from + 1 : 0;
  const end = p.to;
  
  let remaining = Math.max(0, totalVal);
  
  // First clear old values in the range for this item
  for (let i = start; i <= end; i++) {
    if (p.materials[i]) {
      // We check if this step actually NEEDS the item before touching it
      const step = MATERIALS[i];
      const needsItem = step.items.some(spec => {
        const resolved = resolveItemSpec(spec, unitKey);
        return resolved.some(r => r.itemKey === itemKey);
      });
      if (needsItem) {
        const stepMax = MATERIALS[i].items.reduce((acc, spec) => {
           const resolved = resolveItemSpec(spec, unitKey);
           const match = resolved.find(r => r.itemKey === itemKey);
           return acc + (match ? match.max : 0);
        }, 0);
        
        const assign = Math.min(stepMax, remaining);
        p.materials[i][itemKey] = assign;
        remaining -= assign;
      }
    }
  }
}


// ─── Save / Load ──────────────────────────────────────────────────────────────
function saveState() {
  storage.set({
    [STORAGE_KEY]: {
      progress: state.progress,
      splitMats: state.splitMats,
      hideCompleted: state.hideCompleted,
      displayMode: state.displayMode,
    }
  });
}

// ─── Compute flat material list for a unit/step-range ─────────────────────────
/**
 * Returns an array of steps (when splitMats=true) or one merged step.
 * Each step = { name, items: [{ itemKey, max, owned, stepIdx }] }
 */
function computeMaterials(unitKey) {
  ensureProgress(unitKey);
  const p = state.progress[unitKey];
  const start = p.from + 1;
  const end   = p.to;
  const steps = [];

  if (state.splitMats) {
    for (let i = start; i <= end; i++) {
      const step = MATERIALS[i];
      if (!step) continue;
      const buffer = {};
      for (const spec of step.items) {
        const resolved = resolveItemSpec(spec, unitKey);
        for (const { itemKey, max, category } of resolved) {
          if (!buffer[itemKey]) buffer[itemKey] = { itemKey, max: 0, stepIdx: i, category };
          buffer[itemKey].max += max;
        }
      }
      const items = Object.values(buffer).map(r => ({
        ...r,
        category: buffer[r.itemKey].category,
        owned: getOwned(unitKey, r.stepIdx, r.itemKey),
      }));
      items.sort((a, b) => {
        if (a.category !== b.category) return a.category - b.category;
        return a.max - b.max;
      });
      steps.push({ name: step.name, items });
    }
  } else {
    const buffer = {};
    for (let i = start; i <= end; i++) {
      const step = MATERIALS[i];
      if (!step) continue;
      for (const spec of step.items) {
        const resolved = resolveItemSpec(spec, unitKey);
        for (const { itemKey, max, category } of resolved) {
          if (!buffer[itemKey]) buffer[itemKey] = { itemKey, max: 0, stepIdx: i, category };
          buffer[itemKey].max += max;
        }
      }
    }
    // In merged mode, owned is sum across all steps
    const items = Object.values(buffer).map(r => {
      let totalOwned = 0;
      for (let i = start; i <= end; i++) {
        totalOwned += getOwned(unitKey, i, r.itemKey);
      }
      return { ...r, category: r.category, owned: totalOwned };
    });
    items.sort((a, b) => {
      if (a.category !== b.category) return a.category - b.category;
      return a.max - b.max;
    });
    steps.push({ name: 'Materials', items });
  }

  return steps;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function renderAll() {
  renderAddDropdown();
  renderUnits();
}

function renderAddDropdown() {
  const sel = document.getElementById('evoker-select');
  const btn = document.getElementById('btn-add');
  sel.innerHTML = '<option value="-1" disabled selected>--- Select an Evoker ---</option>';
  Object.entries(UNITS).forEach(([id, u]) => {
    if (state.progress[id]) return; // already added
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = u.name;
    sel.appendChild(opt);
  });
  sel.value = '-1';
  btn.disabled = true;
  sel.addEventListener('change', () => {
    btn.disabled = sel.value === '-1';
  });
}

function renderUnits() {
  const container = document.getElementById('units-container');
  container.innerHTML = '';

  const keys = Object.keys(state.progress);
  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-state">Select an Evoker above and click Add to begin.</div>';
    return;
  }

  for (const unitKey of keys) {
    container.appendChild(buildUnitCard(unitKey));
  }
}

// Redraw only the unit cards, leaving the "add" dropdown alone, and rebind
// their events — used by the toolbar checkboxes, where the list of units
// itself doesn't change.
function renderUnitsOnly() {
  const container = document.getElementById('units-container');
  const keys = Object.keys(state.progress);
  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-state">Select an Evoker above and click Add to begin.</div>';
    return;
  }
  container.innerHTML = '';
  for (const unitKey of keys) {
    const card = buildUnitCard(unitKey);
    container.appendChild(card);
    bindUnitEvents(card, unitKey);
  }
}

function buildUnitCard(unitKey) {
  const unit = UNITS[unitKey];
  const p    = state.progress[unitKey];

  const card = document.createElement('div');
  card.className = 'unit-card';
  card.dataset.unit = unitKey;

  // Header
  const header = document.createElement('div');
  header.className = 'unit-header';
  header.innerHTML = `
    <div></div>
    <div class="unit-title" data-fold="${unitKey}">
      ${unit.name}
      <span class="arrow">${p.fold ? '▶' : '▼'}</span>
    </div>
    <button class="btn btn-danger" data-remove="${unitKey}" title="Remove">✕</button>
  `;
  card.appendChild(header);

  if (p.fold) { return card; }

  // Controls
  const controls = document.createElement('div');
  controls.className = 'unit-controls';

  const fromSel = document.createElement('select');
  fromSel.id = `from-${unitKey}`;
  fromSel.innerHTML = '<option value="-1">-- Nothing --</option>';
  MATERIALS.slice(0, -1).forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = s.name;
    fromSel.appendChild(o);
  });
  fromSel.value = p.from;

  const toSel = document.createElement('select');
  toSel.id = `to-${unitKey}`;
  MATERIALS.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = s.name;
    o.disabled = p.from >= i;
    toSel.appendChild(o);
  });
  toSel.value = p.to;

  const lFrom = document.createElement('label'); lFrom.textContent = 'Completed step';
  const lTo   = document.createElement('label'); lTo.textContent = 'Target step';
  
  const g1 = document.createElement('div'); g1.className = 'ctrl-group';
  g1.append(lFrom, fromSel);
  
  const g2 = document.createElement('div'); g2.className = 'ctrl-group';
  g2.append(lTo, toSel);

  controls.append(g1, g2);

  card.appendChild(controls);

  // Materials sections
  const stepsData = computeMaterials(unitKey);
  for (const stepData of stepsData) {
    const section = buildStepSection(unitKey, stepData);
    card.appendChild(section);
  }

  return card;
}

function buildStepSection(unitKey, stepData) {
  const section = document.createElement('div');
  section.className = 'step-section';

  const nameEl = document.createElement('div');
  nameEl.className = 'step-name';
  nameEl.textContent = stepData.name;
  section.appendChild(nameEl);

  const grid = document.createElement('div');
  grid.className = state.displayMode === 0 ? 'mat-grid' : 'mat-list';
  section.appendChild(grid);

  for (const item of stepData.items) {
    if (state.hideCompleted && item.owned >= item.max) continue;
    const el = state.displayMode === 0
      ? buildGridItem(unitKey, stepData, item)
      : buildListItem(unitKey, stepData, item);
    grid.appendChild(el);
  }

  if (grid.children.length === 0) {
    const done = document.createElement('div');
    done.style.cssText = 'color:#4caf50; font-size:12px; padding:4px 0;';
    done.textContent = '✓ All completed';
    section.appendChild(done);
  }

  return section;
}

function buildGridItem(unitKey, stepData, item) {
  const completed = item.owned >= item.max;
  const div = document.createElement('div');
  div.className = 'mat-item' + (completed ? ' completed' : '');

  const img = createImgEl(item.itemKey, 64);
  div.appendChild(img);

  const name = document.createElement('div');
  name.className = 'mat-name';
  name.textContent = getItemName(item.itemKey);
  div.appendChild(name);

  const qty = document.createElement('div');
  qty.className = 'mat-qty';
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '0'; inp.max = item.max;
  inp.value = item.owned;
  inp.addEventListener('change', () => {
    if (state.splitMats) setOwned(unitKey, item.stepIdx, item.itemKey, Number(inp.value));
    else setOwnedDistributed(unitKey, item.itemKey, Number(inp.value));
    saveState();
    rerenderUnit(unitKey);
  });
  const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/';
  const maxEl = document.createElement('span'); maxEl.className = 'max'; maxEl.textContent = item.max;
  qty.append(inp, sep, maxEl);
  div.appendChild(qty);

  if (!completed) {
    const check = document.createElement('span');
    check.className = 'check-icon'; check.title = 'Mark complete'; check.textContent = '✓';
    check.addEventListener('click', () => {
      if (state.splitMats) setOwned(unitKey, item.stepIdx, item.itemKey, item.max);
      else setOwnedDistributed(unitKey, item.itemKey, item.max); // Для общего списка max - это сумма всех шагов
      saveState();
      rerenderUnit(unitKey);
    });
    div.appendChild(check);
  }

  return div;
}

function buildListItem(unitKey, stepData, item) {
  const completed = item.owned >= item.max;
  const div = document.createElement('div');
  div.className = 'mat-list-item' + (completed ? ' completed' : '');

  const img = createImgEl(item.itemKey, 36);
  const nameEl = document.createElement('span');
  nameEl.className = 'li-name';
  nameEl.textContent = getItemName(item.itemKey);

  const qtyDiv = document.createElement('div');
  qtyDiv.className = 'li-qty';
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '0'; inp.max = item.max;
  inp.value = item.owned;
  inp.addEventListener('change', () => {
    if (state.splitMats) setOwned(unitKey, item.stepIdx, item.itemKey, Number(inp.value));
    else setOwnedDistributed(unitKey, item.itemKey, Number(inp.value));
    saveState();
    rerenderUnit(unitKey);
  });
  qtyDiv.appendChild(inp);

  const maxEl = document.createElement('span');
  maxEl.className = 'li-max';
  maxEl.textContent = '/ ' + item.max;

  div.append(img, nameEl, qtyDiv, maxEl);
  return div;
}

function rerenderUnit(unitKey) {
  const container = document.getElementById('units-container');
  const existing = container.querySelector(`[data-unit="${unitKey}"]`);
  if (existing) {
    const fresh = buildUnitCard(unitKey);
    container.replaceChild(fresh, existing);
    bindUnitEvents(fresh, unitKey);
  }
}

function bindUnitEvents(card, unitKey) {
  card.querySelector(`[data-fold="${unitKey}"]`)?.addEventListener('click', () => {
    state.progress[unitKey].fold = !state.progress[unitKey].fold;
    saveState();
    rerenderUnit(unitKey);
  });
  card.querySelector(`[data-remove="${unitKey}"]`)?.addEventListener('click', () => {
    delete state.progress[unitKey];
    saveState();
    renderAll();
  });
  const fromSel = card.querySelector(`#from-${unitKey}`);
  const toSel   = card.querySelector(`#to-${unitKey}`);
  if (fromSel) {
    fromSel.addEventListener('change', () => {
      state.progress[unitKey].from = Number(fromSel.value);
      if (state.progress[unitKey].from >= state.progress[unitKey].to) {
        state.progress[unitKey].to = Math.min(MATERIALS.length - 1, state.progress[unitKey].from + 1);
      }
      saveState();
      rerenderUnit(unitKey);
    });
  }
  if (toSel) {
    toSel.addEventListener('change', () => {
      const v = Number(toSel.value);
      if (v <= state.progress[unitKey].from) return;
      state.progress[unitKey].to = v;
      saveState();
      rerenderUnit(unitKey);
    });
  }
}

// ─── Toolbar events ───────────────────────────────────────────────────────────
function bindToolbarEvents() {

  document.getElementById('btn-add').addEventListener('click', () => {
    const sel = document.getElementById('evoker-select');
    const key = sel.value;
    if (key === '-1') return;
    ensureProgress(key);
    saveState();
    renderAll();
    // Bind events to the new card
    const card = document.querySelector(`[data-unit="${key}"]`);
    if (card) bindUnitEvents(card, key);
  });

  document.getElementById('chk-split').addEventListener('change', (e) => {
    state.splitMats = e.target.checked;
    saveState();
    renderUnitsOnly();
  });
  document.getElementById('chk-hide').addEventListener('change', (e) => {
    state.hideCompleted = e.target.checked;
    saveState();
    renderUnitsOnly();
  });
  document.getElementById('display-mode').addEventListener('change', (e) => {
    state.displayMode = Number(e.target.value);
    saveState();
    renderUnitsOnly();
  });

}

function syncUiFromState() {
  document.getElementById('chk-split').checked = state.splitMats;
  document.getElementById('chk-hide').checked  = state.hideCompleted;
  document.getElementById('display-mode').value = String(state.displayMode);
}

function getItemName(key) {
  if (ITEMS[key]) return ITEMS[key];
  // Basic auto-formatting for unknown keys
  return key.replace(/borneastra/i, ' Astra')
            .replace(/idean/i, ' Idean')
            .replace(/veritas/i, ' Veritas')
            .replace(/fragment/i, ' Fragment')
            .replace(/anima/i, ' Anima')
            .split(/(?=[A-Z])|_/)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ');
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Подтягиваем свежие данные из облака при каждой перезагрузке страницы (F5).
// Результат придёт асинхронно через chrome.storage.onChanged ниже и сам
// обновит состояние — здесь просто инициируем запрос.
if (IS_EXTENSION) chrome.runtime.sendMessage({ type: 'SYNC_DOWNLOAD' });

storage.get([STORAGE_KEY], (res) => {
  const stored = res[STORAGE_KEY] || {};

  if (stored.progress)              state.progress    = stored.progress;
  if (stored.splitMats !== undefined) state.splitMats = stored.splitMats;
  if (stored.hideCompleted !== undefined) state.hideCompleted = stored.hideCompleted;
  if (stored.displayMode !== undefined)  state.displayMode  = stored.displayMode;

  // Ensure all loaded progress has correct length
  Object.keys(state.progress).forEach(k => ensureProgress(k));

  syncUiFromState();
  bindToolbarEvents();
  renderAll();

  // Bind events to pre-existing unit cards
  Object.keys(state.progress).forEach(k => {
    const card = document.querySelector(`[data-unit="${k}"]`);
    if (card) bindUnitEvents(card, k);
  });
});

if (IS_EXTENSION) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      const d = changes[STORAGE_KEY].newValue;
      if (!d) return;
      if (d.progress)    state.progress    = d.progress;
      if (d.splitMats  !== undefined) state.splitMats  = d.splitMats;
      if (d.hideCompleted !== undefined) state.hideCompleted = d.hideCompleted;
      if (d.displayMode !== undefined) state.displayMode = d.displayMode;
      
      Object.keys(state.progress).forEach(k => ensureProgress(k));
      syncUiFromState();
      renderAll();
      Object.keys(state.progress).forEach(k => {
        const card = document.querySelector(`[data-unit="${k}"]`);
        if (card) bindUnitEvents(card, k);
      });
    }
  });
}
