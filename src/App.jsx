import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "./firebase.js";
import { ref, push, onValue, set, get } from "firebase/database";
import L from "leaflet";
// Fix Leaflet default icon for Vite builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const KRISHIMITRA_SYSTEM_PROMPT = `You are KrishiMitra AI — a multilingual agricultural assistant designed for Indian farmers.

Your goal:
Provide short, accurate, low-cost, actionable crop advice based on:
1. Farmer's question
2. Current crop and location context

RESPONSE RULES:
- Use simple farmer-friendly language
- Maximum 5 bullet points
- No long paragraphs
- No technical jargon
- Focus only on actionable steps
- Keep answers under 120 words

ALWAYS STRUCTURE RESPONSE IN THIS ORDER:
1. 🦠 Problem / Cause
2. ⚡ What to do TODAY
3. 💰 Low-cost chemical option (dosage per liter, spray timing)
4. 🌿 Organic / natural option
5. ⏱ Next 3–5 day monitoring advice

MULTILINGUAL BEHAVIOR:
- Detect farmer language automatically
- Respond in the SAME language as the farmer
- Support Hindi, English, Marathi, and other Indian languages

TREATMENT GUIDELINES:
- Include dosage per liter of water
- Spray timing (morning/evening)
- Safety note (mask, gloves)

PROHIBITED:
- No laboratory explanations
- No scientific names unless necessary
- No paragraphs
- No generic internet advice

TONE: Helpful, respectful, confident. Like a local Krishi officer.

END EVERY RESPONSE WITH: "और सहायता के लिए पूछें"`;

const LANGUAGES = [
  {code:"en",native:"EN"},{code:"hi",native:"हि"},{code:"mr",native:"म"},
  {code:"ta",native:"த"},{code:"te",native:"తె"},{code:"kn",native:"ಕ"},
  {code:"pa",native:"ਪ"},{code:"gu",native:"ગ"},{code:"bn",native:"ব"},
];
// Maps each state to its primary language code
const STATE_LANG = {
  "Maharashtra":"mr",
  "Punjab":"pa",
  "Gujarat":"gu",
  "Karnataka":"kn",
  "Andhra Pradesh":"te",
  "Telangana":"te",
  "Tamil Nadu":"ta",
  "West Bengal":"bn",
  "Haryana":"hi",
  "Uttar Pradesh":"hi",
  "Bihar":"hi",
  "Rajasthan":"hi",
  "Madhya Pradesh":"hi",
  "Odisha":"hi",
  "Kerala":"hi",
};
const DEFAULT_STATE = "Maharashtra";
const getStateDefaultLang = (st) => STATE_LANG[st] || "en";
const LANG_NAMES = {
  en:"English", hi:"Hindi", mr:"Marathi",
  ta:"Tamil", te:"Telugu", kn:"Kannada",
  pa:"Punjabi", gu:"Gujarati", bn:"Bengali",
};
const STATES = ["Andhra Pradesh","Bihar","Gujarat","Haryana","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Odisha","Punjab","Rajasthan","Tamil Nadu","Telangana","Uttar Pradesh","West Bengal"];
const STATE_DIALECT = {
  "Haryana":{dialect:"Haryanvi Hindi"},"Punjab":{dialect:"Punjabi"},
  "Uttar Pradesh":{dialect:"Bhojpuri Hindi"},"Bihar":{dialect:"Bhojpuri Hindi"},
  "Rajasthan":{dialect:"Marwari Hindi"},"Madhya Pradesh":{dialect:"Malwi Hindi"},
  "Maharashtra":{dialect:"Marathi"},"Gujarat":{dialect:"Gujarati"},
  "Karnataka":{dialect:"Kannada"},"Andhra Pradesh":{dialect:"Telugu"},
  "Telangana":{dialect:"Telangana Telugu"},"Tamil Nadu":{dialect:"Tamil"},
  "Kerala":{dialect:"Malayalam"},"Odisha":{dialect:"Odia"},"West Bengal":{dialect:"Bengali"},
};
const CROPS = ["Rice","Wheat","Tomato","Potato","Cotton","Maize","Sugarcane","Onion","Soybean","Groundnut","Chili","Brinjal"];
const CROP_DISEASES = {
  Rice:       ["Blast","Brown Spot","Sheath Blight","Bacterial Leaf Blight","False Smut","Tungro","Stem Rot","Neck Rot"],
  Wheat:      ["Yellow Rust","Brown Rust","Powdery Mildew","Loose Smut","Karnal Bunt","Septoria Leaf Spot","Foot Rot"],
  Tomato:     ["Early Blight","Late Blight","Fusarium Wilt","Bacterial Wilt","Leaf Curl Virus","Mosaic Virus","Septoria Leaf Spot","Damping Off"],
  Potato:     ["Late Blight","Early Blight","Black Scurf","Common Scab","Bacterial Wilt","Mosaic Virus","Dry Rot"],
  Cotton:     ["Cotton Leaf Curl Virus","Fusarium Wilt","Verticillium Wilt","Alternaria Blight","Grey Mildew","Bacterial Blight","Root Rot"],
  Maize:      ["Turcicum Blight","Downy Mildew","Smut","Stalk Rot","Leaf Blight","Rust","Maydis Leaf Blight"],
  Sugarcane:  ["Red Rot","Smut","Ratoon Stunting Disease","Wilt","Pokkah Boeng","Grassy Shoot Disease","Pineapple Disease"],
  Onion:      ["Purple Blotch","Stemphylium Blight","Downy Mildew","Basal Rot","Neck Rot","Black Mould","White Rot"],
  Soybean:    ["Rust","Bacterial Pustule","Frog Eye Leaf Spot","Charcoal Rot","Root Rot","Mosaic Virus","Pod Blight"],
  Groundnut:  ["Tikka (Early Leaf Spot)","Late Leaf Spot","Rust","Stem Rot","Crown Rot","Collar Rot","Bud Necrosis"],
  Chili:      ["Anthracnose","Powdery Mildew","Bacterial Wilt","Leaf Curl Virus","Damping Off","Cercospora Leaf Spot"],
  Brinjal:    ["Little Leaf Disease","Phomopsis Blight","Bacterial Wilt","Leaf Spot","Fusarium Wilt","Damping Off"],
};
const SEV_CLR = {Mild:"#00D4CC",Moderate:"#E8A020",Severe:"#FF2D55"};
const ALERT_THRESHOLD = 2;
const RADIUS_KM = 5;
const PRONE_THRESHOLD = 3;

const STATE_AGI_DATA = {
  "Maharashtra":{
    season:"Zaid/Summer", soil:"Black Cotton Soil", rain:"500–3000mm",
    diseases:["Early/Late Blight","Bollworm","Yellow Mosaic"],
    pestAlert:"Fall Armyworm active in Marathwada.",
    water:"83% rainfed. Drip push active.",
    soilCare:"Apply Zinc Sulphate 25 kg/ha every 3 seasons.",
    crops:["Sugarcane","Cotton","Soybean","Onion","Grapes"],
    schemes:["Nanaji Deshmukh Krishi Sanjivani","PM-KISAN","PMFBY"],
    university:"VNMKV, Parbhani", helpline:"1800-233-4000",
    cropTip:"Soybean thrips peak in June–July. Spray Imidacloprid 17.8% SL at 0.3 ml/L.",
    weatherHint:"Pre-monsoon dry spells increase fusarium wilt in cotton.",
  },
  "Punjab":{
    season:"Rabi/Wheat", soil:"Alluvial Sandy Loam", rain:"400–750mm",
    diseases:["Yellow Rust","Karnal Bunt","Leaf Rust"],
    pestAlert:"Pink Bollworm pressure rising in Bathinda region.",
    water:"95% irrigated via canals. Waterlogging risk in Nov–Jan.",
    soilCare:"Reduce urea; switch to nano-urea 500 ml/acre to cut costs.",
    crops:["Wheat","Rice","Cotton","Maize","Potato"],
    schemes:["RKVY","PM-KISAN","Crop Residue Management Scheme"],
    university:"PAU Ludhiana", helpline:"1800-180-2117",
    cropTip:"Stubble burning ban active. Use Happy Seeder for zero-till wheat.",
    weatherHint:"Foggy winters increase yellow rust spread — spray Propiconazole at first sign.",
  },
  "Uttar Pradesh":{
    season:"Rabi/Kharif Mixed", soil:"Alluvial Indo-Gangetic", rain:"700–1200mm",
    diseases:["Bakanae Disease","Sheath Blight","Brown Plant Hopper"],
    pestAlert:"Locust watch active in western UP borders.",
    water:"75% irrigated, canal + tubewell based.",
    soilCare:"FYM 10 t/ha before Kharif. Avoid waterlogging in clay pockets.",
    crops:["Wheat","Rice","Sugarcane","Mustard","Potato"],
    schemes:["UP Krishi Yantra Sahayata","PM-KISAN","PMFBY"],
    university:"CSAUAT, Kanpur", helpline:"1800-180-5566",
    cropTip:"Sugarcane red rot season peaks Jul–Sep. Treat setts with Carbendazim.",
    weatherHint:"Heavy July rains cause sheath blight in rice. Drain fields within 24 hrs.",
  },
  "Haryana":{
    season:"Rabi Dominant", soil:"Sandy Loam to Loam", rain:"350–1000mm",
    diseases:["Alternaria Blight","Downy Mildew","White Rust"],
    pestAlert:"Whitefly population surge reported in Sirsa.",
    water:"90% irrigated. Canal-dependent in Hisar, Rohtak.",
    soilCare:"Gypsum 250 kg/ha for sodium-affected soils.",
    crops:["Wheat","Rice","Cotton","Bajra","Mustard"],
    schemes:["Mera Pani Meri Virasat","PM-KISAN","Kisan Mitra"],
    university:"CCS HAU, Hisar", helpline:"1800-180-1551",
    cropTip:"Bajra downy mildew — use resistant varieties like HHB-67.",
    weatherHint:"Hot dry winds (loo) in May accelerate leaf scorch in wheat.",
  },
  "Gujarat":{
    season:"Kharif Dominant", soil:"Black, Alluvial, Sandy", rain:"400–2000mm",
    diseases:["Groundnut Tikka","Sucking Pest","Alternaria"],
    pestAlert:"Spodoptera litura on groundnut — monitor in Junagadh.",
    water:"70% rainfed. Drip subsidy active for cash crops.",
    soilCare:"Micronutrient mix (Zn+B) for sandy soils every 2 seasons.",
    crops:["Groundnut","Cotton","Tobacco","Wheat","Sesame"],
    schemes:["Mukhyamantri Kisan Sahay","PM-KISAN","PMFBY"],
    university:"AAU, Anand", helpline:"1800-233-6030",
    cropTip:"Groundnut leaf miner — rotate with sesame to break pest cycle.",
    weatherHint:"Saurashtra dry spells post-July increase aflatoxin risk in groundnut.",
  },
  "Karnataka":{
    season:"Kharif & Rabi Mixed", soil:"Red Laterite & Black", rain:"600–4500mm",
    diseases:["Coffee Berry Borer","Tungro Virus","Stem Borer"],
    pestAlert:"Coffee white stem borer active in Coorg district.",
    water:"65% rainfed. Kaveri-fed districts have assured irrigation.",
    soilCare:"Lime 200 kg/ha for acidic red soils (pH < 5.5).",
    crops:["Rice","Ragi","Maize","Sugarcane","Coffee"],
    schemes:["Raitha Samparka Kendra","PM-KISAN","PMFBY"],
    university:"UAS Dharwad", helpline:"1800-425-1188",
    cropTip:"Ragi blast management — spray Tricyclazole 0.06% at flag leaf stage.",
    weatherHint:"High humidity after September rainfall triggers coffee leaf rust.",
  },
  "Andhra Pradesh":{
    season:"Kharif Rice", soil:"Alluvial Delta & Red Loam", rain:"900–1200mm",
    diseases:["Blast","BLB","Gall Midge"],
    pestAlert:"Yellow stem borer activity high in Krishna-Godavari delta.",
    water:"85% canal irrigated in Krishna-Godavari delta.",
    soilCare:"Apply FeSO4 20 kg/ha for iron-deficient red soils.",
    crops:["Rice","Chili","Tobacco","Cotton","Groundnut"],
    schemes:["YSR Free Crop Insurance","PM-KISAN","Rythu Bharosa"],
    university:"ANGRAU, Guntur", helpline:"1800-425-2932",
    cropTip:"Chili anthracnose — apply Mancozeb+Carbendazim at fruiting.",
    weatherHint:"Pre-harvest rains cause blast resurgence — spray before panicle emergence.",
  },
  "Telangana":{
    season:"Kharif Dominant", soil:"Red Sandy & Black Cotton", rain:"700–1200mm",
    diseases:["Boll Weevil","Wilt","Nematodes"],
    pestAlert:"Pink bollworm resistant strains detected in Warangal.",
    water:"70% rainfed, Mission Kakatiya tanks revived.",
    soilCare:"Green manure (Dhaincha) for red sandy soils before cotton.",
    crops:["Cotton","Rice","Maize","Soybean","Sunflower"],
    schemes:["Rythu Bandhu","PM-KISAN","PMFBY"],
    university:"PJTSAU, Hyderabad", helpline:"1800-425-2470",
    cropTip:"Cotton bollworm — use pheromone traps 5/acre from 30 DAS.",
    weatherHint:"Dry October winds accelerate wilt in cotton — irrigate weekly.",
  },
  "Tamil Nadu":{
    season:"Samba/NE Monsoon", soil:"Red Loam, Clay, Alluvial", rain:"600–2500mm",
    diseases:["Blast","Sheath Rot","Brown Spot"],
    pestAlert:"Thrips in banana — Jaffna & Nilgiris region.",
    water:"80% canal irrigated in delta districts.",
    soilCare:"Green leaf manure 12.5 t/ha for poor red soils.",
    crops:["Rice","Banana","Sugarcane","Groundnut","Coconut"],
    schemes:["CM Uzhavar Padhukappu","PM-KISAN","TNAU Schemes"],
    university:"TNAU, Coimbatore", helpline:"1800-425-1110",
    cropTip:"Banana sigatoka — apply Propiconazole 1 ml/L monthly.",
    weatherHint:"NE monsoon delay causes drought stress in Samba paddy.",
  },
  "Kerala":{
    season:"Kharif/SW Monsoon", soil:"Laterite, Alluvial, Sandy", rain:"2000–5000mm",
    diseases:["Phytophthora","Pepper Yellows","Coconut Wilt"],
    pestAlert:"Pink mealy bug on cocoa in Thrissur.",
    water:"97% rainfed. Excess water causes waterlogging in low areas.",
    soilCare:"Lime 500 kg/ha + slag for laterite soils. pH < 5 is common.",
    crops:["Coconut","Rice","Pepper","Rubber","Banana"],
    schemes:["Krishitharam","PM-KISAN","Kerala Agri Dept Schemes"],
    university:"KAU, Thrissur", helpline:"1800-425-1551",
    cropTip:"Coconut root wilt — apply NFT (neem, fish meal, trichoderma) basally.",
    weatherHint:"Post-onam floods increase pythium root rot in vegetable plots.",
  },
  "Rajasthan":{
    season:"Rabi/Arid Zone", soil:"Sandy Desert & Sandy Loam", rain:"100–800mm",
    diseases:["Powdery Mildew","Alternaria","Cutworm"],
    pestAlert:"Desert locust watch — Barmer & Jaisalmer border.",
    water:"Mostly rainfed. IGNP canal in western belt.",
    soilCare:"Organic matter critical. Apply FYM 15 t/ha annually.",
    crops:["Bajra","Moth Bean","Mustard","Wheat","Cumin"],
    schemes:["Mukhyamantri Krishi Upkaran","PM-KISAN","PMFBY"],
    university:"SKRAU, Bikaner", helpline:"1800-180-6001",
    cropTip:"Cumin blight — use disease-free seed + Mancozeb 0.2% spray.",
    weatherHint:"Cold night + warm day in Feb triggers powdery mildew on mustard.",
  },
  "Madhya Pradesh":{
    season:"Kharif + Rabi", soil:"Black Cotton & Red Laterite", rain:"800–1800mm",
    diseases:["Soybean Yellow Mosaic","Powdery Mildew","Stem Fly"],
    pestAlert:"Stem fly pressure rising in Ujjain soybean belt.",
    water:"70% rainfed. Narmada command in pilot expansion.",
    soilCare:"Zinc deficiency common. Apply 25 kg ZnSO4/ha in Kharif.",
    crops:["Soybean","Wheat","Gram","Maize","Mustard"],
    schemes:["Kisan Samman Nidhi","PM-KISAN","Bhavantar Bhugtan"],
    university:"JNKVV, Jabalpur", helpline:"1800-180-1551",
    cropTip:"Soybean YMV — control whitefly vector with Thiamethoxam 25 WG.",
    weatherHint:"Early rains in Vidarbha border increase blue mold on tobacco.",
  },
  "Bihar":{
    season:"Kharif & Rabi Mixed", soil:"Alluvial Gangetic, Chaur", rain:"1000–1500mm",
    diseases:["Tungro","Army Worm","Maize Borer"],
    pestAlert:"Fall armyworm in maize — Munger, Bhagalpur region.",
    water:"80% rainfed + flood-prone in North Bihar.",
    soilCare:"Raised bed planting in flood-prone areas. Azolla for paddy.",
    crops:["Rice","Wheat","Maize","Vegetables","Makhana"],
    schemes:["Bihar Rajya Fasal Sahayata","PM-KISAN","PMFBY"],
    university:"BAU, Sabour", helpline:"1800-180-1551",
    cropTip:"Makhana blast — maintain 8–12 cm water level during flowering.",
    weatherHint:"July flood surge causes khaira disease in paddy — apply ZnSO4.",
  },
  "Odisha":{
    season:"Kharif Rice Dominant", soil:"Red Laterite & Alluvial", rain:"1200–1800mm",
    diseases:["Blast","Hispa","Gall Midge"],
    pestAlert:"Rice gall midge resurgence in Cuttack district.",
    water:"72% rainfed. Mahanadi canal in coastal zones.",
    soilCare:"Apply 25 kg/ha lime for low-pH red soils.",
    crops:["Rice","Maize","Groundnut","Sugarcane","Vegetables"],
    schemes:["KALIA","PM-KISAN","PMFBY"],
    university:"OUAT, Bhubaneswar", helpline:"1800-345-6770",
    cropTip:"Gall midge-resistant varieties: Swarna, Tapaswini, Pratikshya.",
    weatherHint:"Cyclone season (Oct–Nov) causes salt spray damage to coastal crops.",
  },
  "West Bengal":{
    season:"Boro/Aman Mixed", soil:"Alluvial & Laterite", rain:"1200–2500mm",
    diseases:["BLB","Brown Spot","Stem Rot"],
    pestAlert:"BLB (bacterial leaf blight) high in Burdwan delta.",
    water:"85% irrigated in delta areas.",
    soilCare:"Avoid excess N in BLB-prone areas. Balance K application.",
    crops:["Rice","Jute","Tea","Potato","Vegetables"],
    schemes:["Krishak Bandhu","PM-KISAN","PMFBY"],
    university:"BCKV, Mohanpur", helpline:"1800-345-5555",
    cropTip:"Jute stem rot — drain field within 24 hrs of waterlogging.",
    weatherHint:"High humidity in September accelerates BLB in Aman paddy.",
  },
};


function haversine(lat1,lon1,lat2,lon2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
const norm = s => s?.toLowerCase().trim() || "";
const comboKey = (state,crop,disease) => [norm(state),norm(crop),norm(disease)].join("|");
const INR = n => "₹" + Number(n||0).toLocaleString("en-IN");

// ── Ticker ──────────────────────────────────────────────────────────────────
function Ticker({value}){
  const [n,setN]=useState(0);
  useEffect(()=>{
    let v=0; const step=value/60;
    const id=setInterval(()=>{v=Math.min(v+step,value);setN(Math.round(v));if(v>=value)clearInterval(id);},16);
    return()=>clearInterval(id);
  },[value]);
  return <>{n}</>;
}

// ── Panel / Strip / Badge ────────────────────────────────────────────────────
function Panel({children,accent="#E8650A",style={},onClick}){
  return(
    <div onClick={onClick} style={{border:`3px solid ${accent}`,background:"#120D02",position:"relative",...style}}>
      {["tl","tr","bl","br"].map(p=>(
        <div key={p} style={{position:"absolute",width:9,height:9,borderRadius:"50%",background:accent,opacity:.75,
          top:p[0]==="t"?-5:"auto",bottom:p[0]==="b"?-5:"auto",left:p[1]==="l"?-5:"auto",right:p[1]==="r"?-5:"auto"}}/>
      ))}
      {children}
    </div>
  );
}
function Strip({children,bg="#E8650A",color="#0F0A00",style={}}){
  return <div style={{display:"inline-block",background:bg,color,padding:"3px 12px",fontFamily:"'Bebas Neue',cursive",fontSize:"0.68rem",letterSpacing:"0.22em",...style}}>{children}</div>;
}
function SevBadge({severity}){
  const c=SEV_CLR[severity]||"#E8650A";
  return <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",letterSpacing:".14em",color:c,border:`2px solid ${c}`,padding:"2px 8px"}}>{severity?.toUpperCase()}</span>;
}

// ── Treatment Cost & Yield Comparison ───────────────────────────────────────
function TreatmentComparison({comparison,loading,onGenerate}){
  const [expanded,setExpanded]=useState(false);

  if(loading) return(
    <div style={{marginTop:10,background:"rgba(123,158,74,0.06)",border:"1px solid rgba(123,158,74,0.25)",padding:"14px",textAlign:"center"}}>
      <div style={{display:"inline-block",width:22,height:22,border:"2px solid rgba(123,158,74,.2)",borderTop:"2px solid #7B9E4A",borderRadius:"50%",animation:"spin .85s linear infinite",marginBottom:6}}/>
      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",letterSpacing:".15em",color:"#7B9E4A"}}>CALCULATING ECONOMICS…</div>
    </div>
  );

  if(!comparison) return(
    <div style={{marginTop:10,background:"rgba(123,158,74,0.06)",border:"1px solid rgba(123,158,74,0.25)",padding:"12px 14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".18em",color:"#7B9E4A"}}>💰 COST & YIELD ANALYSIS</div>
          <div style={{fontSize:"0.7rem",color:"#4A3820",marginTop:3}}>Compare chemical vs organic economics per acre</div>
        </div>
        <button onClick={onGenerate} style={{background:"transparent",border:"2px solid #7B9E4A",color:"#7B9E4A",fontFamily:"'Bebas Neue',cursive",fontSize:"0.72rem",letterSpacing:".12em",padding:"5px 12px",cursor:"pointer"}}>ANALYSE</button>
      </div>
    </div>
  );

  const c=comparison.chemical, o=comparison.organic;
  const rec=comparison.recommendation;
  const maxProfit=Math.max(c.netProfitPerAcre||0, o.netProfitPerAcre||0, 1);

  return(
    <div style={{marginTop:10,border:"2px solid rgba(123,158,74,0.4)",background:"#0D0A00"}}>
      {/* Header */}
      <div onClick={()=>setExpanded(!expanded)} style={{background:"rgba(123,158,74,0.12)",borderBottom:"1px solid rgba(123,158,74,0.3)",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.75rem",letterSpacing:".18em",color:"#7B9E4A"}}>💰 COST & YIELD ANALYSIS</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",color:"#4A3820"}}>RECOMMENDED:</span>
          <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.72rem",color:rec==="organic"?"#7B9E4A":"#E8650A",border:"1px solid "+(rec==="organic"?"#7B9E4A":"#E8650A"),padding:"2px 8px"}}>{(rec||"").toUpperCase()}</span>
          <span style={{color:"#6B5530"}}>{expanded?"▲":"▼"}</span>
        </div>
      </div>

      {/* Quick profit summary */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
        {[{label:"CHEMICAL",data:c,accent:"#E8650A"},{label:"ORGANIC",data:o,accent:"#7B9E4A"}].map(({label,data,accent})=>{
          const isBest=(label==="CHEMICAL"&&rec==="chemical")||(label==="ORGANIC"&&rec==="organic");
          return(
            <div key={label} style={{padding:"12px 14px",borderRight:label==="CHEMICAL"?"1px solid rgba(123,158,74,0.2)":"none",position:"relative"}}>
              {isBest&&<div style={{position:"absolute",top:7,right:8,fontFamily:"'Bebas Neue',cursive",fontSize:"0.5rem",background:accent,color:"#0F0A00",padding:"1px 5px"}}>BEST</div>}
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".2em",color:accent,marginBottom:6}}>{label}</div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.5rem",color:"#FFF0D0",lineHeight:1}}>{INR(data.netProfitPerAcre)}</div>
              <div style={{fontSize:"0.58rem",color:"#6B5530",marginBottom:6}}>NET PROFIT / ACRE</div>
              <div style={{height:4,background:"#1E1408",borderRadius:2,marginBottom:6}}>
                <div style={{height:"100%",background:accent,width:((data.netProfitPerAcre||0)/maxProfit*100)+"%",borderRadius:2,transition:"width 1.2s ease .3s"}}/>
              </div>
              <div style={{fontSize:"0.69rem",color:"#A08070",lineHeight:1.8}}>
                <div>Treatment cost: <strong style={{color:accent}}>{INR(data.treatmentCostPerAcre)}</strong></div>
                <div>Yield saved: <strong style={{color:accent}}>{data.yieldSavedPercent}%</strong></div>
                <div>Effectiveness: <strong style={{color:accent}}>{data.effectivenessWeeks} weeks</strong></div>
                <div>ROI: <strong style={{color:accent}}>{data.roi}%</strong></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded breakdown */}
      {expanded&&(
        <div style={{borderTop:"1px solid rgba(123,158,74,0.2)",padding:"14px",animation:"fadeUp .3s ease"}}>

          {/* Cost breakdown bars */}
          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".15em",color:"#6B5530",marginBottom:10}}>FULL COST BREAKDOWN / ACRE</div>
          {[
            {key:"treatmentCostPerAcre",label:"Treatment"},
            {key:"laborCostPerAcre",label:"Labour"},
            {key:"equipmentCostPerAcre",label:"Equipment"},
          ].map(({key,label})=>{
            const maxV=Math.max(c[key]||0, o[key]||0, 1);
            return(
              <div key={key} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:"0.67rem",color:"#6B5530"}}>{label}</span>
                  <span style={{fontSize:"0.67rem"}}>
                    <span style={{color:"#E8650A"}}>{INR(c[key])}</span>
                    <span style={{color:"#4A3820"}}> vs </span>
                    <span style={{color:"#7B9E4A"}}>{INR(o[key])}</span>
                  </span>
                </div>
                {[{val:c[key]||0,accent:"#E8650A"},{val:o[key]||0,accent:"#7B9E4A"}].map(({val,accent},i)=>(
                  <div key={i} style={{height:5,background:"#1E1408",borderRadius:2,marginBottom:3}}>
                    <div style={{height:"100%",background:accent,width:(val/maxV*100)+"%",borderRadius:2,transition:"width 1s ease"}}/>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Yield & Revenue side-by-side */}
          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".15em",color:"#6B5530",marginTop:14,marginBottom:10}}>YIELD & REVENUE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {[{label:"CHEMICAL",data:c,accent:"#E8650A"},{label:"ORGANIC",data:o,accent:"#7B9E4A"}].map(({label,data,accent})=>(
              <div key={label} style={{border:"1px solid "+accent+"44",padding:"10px",background:"rgba(255,255,255,0.02)"}}>
                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",letterSpacing:".15em",color:accent,marginBottom:6}}>{label}</div>
                {[
                  ["Crop Saved", data.yieldSavedPercent+"%"],
                  ["Revenue/Acre", INR(data.revenuePerAcre)],
                  ["Net Profit", INR(data.netProfitPerAcre)],
                  ["ROI", data.roi+"%"],
                  ["Payback", data.paybackWeeks+"w"],
                  ["Env. Risk", data.envRisk],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <span style={{fontSize:"0.65rem",color:"#6B5530"}}>{k}</span>
                    <span style={{fontSize:"0.65rem",color:"#FFF0D0",fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Recommendation box */}
          <div style={{background:"rgba("+(rec==="organic"?"123,158,74":"232,101,10")+",0.1)",border:"1px solid "+(rec==="organic"?"#7B9E4A":"#E8650A"),padding:"12px 14px",marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".15em",color:rec==="organic"?"#7B9E4A":"#E8650A",marginBottom:6}}>
              ⬡ EXPERT RECOMMENDATION: {(rec||"").toUpperCase()} TREATMENT
            </div>
            <p style={{fontSize:"0.78rem",color:"#C8B090",lineHeight:1.75,marginBottom:8}}>{comparison.reasoning}</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {(comparison.keyAdvantages||[]).map((adv,i)=>(
                <span key={i} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#A0B880",padding:"3px 9px",fontSize:"0.7rem"}}>{adv}</span>
              ))}
            </div>
          </div>

          {comparison.marketNote&&(
            <div style={{borderLeft:"3px solid #E8A020",paddingLeft:10}}>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",color:"#E8A020",letterSpacing:".1em",marginBottom:3}}>MARKET NOTE</div>
              <p style={{fontSize:"0.74rem",color:"#8A7060",lineHeight:1.65}}>{comparison.marketNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Prone Area Modal ─────────────────────────────────────────────────────────
function ProneAreaModal({alerts,onDismiss}){
  if(!alerts||!alerts.length) return null;
  return(
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,0.82)"}}>
      <div style={{maxWidth:420,width:"100%",border:"3px solid #FF2D55",background:"#0F0A00"}}>
        <div style={{height:5,background:"linear-gradient(90deg,#FF2D55,#E8A020,#FF2D55)"}}/>
        <div style={{padding:"20px 18px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"rgba(255,45,85,0.15)",border:"2px solid #FF2D55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem"}}>⚠️</div>
            <div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",letterSpacing:".12em",color:"#FF2D55"}}>PRONE AREA ALERT</div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",letterSpacing:".14em",color:"#6B5530",marginTop:3}}>DETECTED BEFORE YOU BEGIN</div>
            </div>
          </div>
          {alerts.map((a,i)=>(
            <div key={i}>
              <div style={{background:"rgba(255,45,85,0.07)",border:"1px solid rgba(255,45,85,0.3)",padding:"12px 14px",marginBottom:8}}>
                <p style={{fontSize:"0.83rem",color:"#FFF0D0",lineHeight:1.8,margin:0}}>
                  <strong style={{color:"#FF2D55"}}>{a.state}</strong> is a <strong style={{color:"#FF2D55"}}>high-risk zone</strong> for{" "}
                  <strong style={{color:"#E8A020"}}>{a.disease}</strong> in <strong style={{color:"#E8A020"}}>{a.crop}</strong> — {a.count} cases recorded.
                </p>
              </div>
            </div>
          ))}
          <button onClick={onDismiss} style={{width:"100%",background:"#FF2D55",border:"none",color:"#0F0A00",fontFamily:"'Bebas Neue',cursive",fontSize:"0.9rem",letterSpacing:".12em",padding:"12px",cursor:"pointer",marginTop:8}}>
            I UNDERSTAND — PROCEED
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Voice Panel ──────────────────────────────────────────────────────────────
function VoicePanel({script,loading,onGenerate,dialect}){
  const [speaking,setSpeaking]=useState(false);
  const speak=()=>{
    if(!script||!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const voices=window.speechSynthesis.getVoices();
    const u=new SpeechSynthesisUtterance(script);
    u.voice=voices.find(v=>v.lang.startsWith("hi"))||voices.find(v=>v.lang.startsWith("en"))||null;
    u.lang="hi-IN"; u.rate=0.85; u.pitch=1.05;
    u.onstart=()=>setSpeaking(true); u.onend=()=>setSpeaking(false); u.onerror=()=>setSpeaking(false);
    setTimeout(()=>window.speechSynthesis.speak(u),100);
  };
  const stop=()=>{window.speechSynthesis?.cancel();setSpeaking(false);};
  return(
    <div style={{marginTop:10,background:"rgba(0,212,204,0.06)",border:"1px solid rgba(0,212,204,0.25)",padding:"12px 14px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".18em",color:"#00D4CC"}}>🎙 KRISHI SEVAK · {dialect.toUpperCase()}</div>
        <div style={{display:"flex",gap:6}}>
          {!script&&!loading&&<button className="btn-ghost" onClick={onGenerate}>▶ GENERATE</button>}
          {loading&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",color:"#6B5530"}}>⏳ GENERATING…</span>}
          {script&&!loading&&!speaking&&<button className="btn-ghost" onClick={speak}>🔊 PLAY</button>}
          {speaking&&<button className="btn-ghost btn-ghost-red" onClick={stop}>◼ STOP</button>}
        </div>
      </div>
      {script&&<p style={{fontSize:"0.81rem",color:"#80C8C4",lineHeight:1.8,fontStyle:"italic",margin:0}}>"{script}"</p>}
      {!script&&!loading&&<p style={{fontSize:"0.75rem",color:"#4A3820",lineHeight:1.6,margin:0}}>Tap GENERATE for a friendly advisory in {dialect}.</p>}
    </div>
  );
}

// ── Outbreak Map ─────────────────────────────────────────────────────────────
function OutbreakMap({ reports, userLoc, alertThreshold, radiusKm, okVotes }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;
    // Init map once
    if (!mapInstanceRef.current) {
      const center = userLoc ? [userLoc.lat, userLoc.lon] : [20.5937, 78.9629];
      mapInstanceRef.current = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false })
        .setView(center, userLoc ? 9 : 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapInstanceRef.current);
    }
    const map = mapInstanceRef.current;
    // Clear old layers
    layersRef.current.forEach(l => { try { map.removeLayer(l); } catch(e){} });
    layersRef.current = [];

    // Group reports by disease + rough grid cell (~11km)
    const groups = {};
    reports.forEach(r => {
      if (!r.lat || !r.lon || r.resolved) return;
      const dk = r.diseaseKey||r.disease||'';
      const gk = dk + '|' + (Math.round(r.lat * 10) / 10) + '|' + (Math.round(r.lon * 10) / 10);
      if (!groups[gk]) groups[gk] = { lat: r.lat, lon: r.lon, diseaseKey: dk, disease: r.disease, severity: r.severity, state: r.state, crops: [], count: 0 };
      groups[gk].count++;
      if (!groups[gk].crops.includes(r.crop)) groups[gk].crops.push(r.crop);
    });

    const allBounds = [];
    Object.values(groups).forEach(g => {
      const isAlert = g.count >= alertThreshold;
      const okCount = okVotes&&okVotes[g.diseaseKey] ? okVotes[g.diseaseKey] : 0;
      const isCalming = okCount > 0 && okCount >= g.count / 2;
      const color = isCalming ? '#888888' : g.severity === 'Severe' ? '#FF2D55' : isAlert ? '#E8650A' : '#E8A020';
      const dist = userLoc ? haversine(userLoc.lat, userLoc.lon, g.lat, g.lon) : null;
      const areaKm2 = (Math.PI * radiusKm * radiusKm).toFixed(0);
      const popupHtml =
        '<div style="font-family:sans-serif;font-size:13px;min-width:170px;line-height:1.6">' +
        '<b style="color:' + color + ';font-size:15px">' + (g.disease || 'Unknown').toUpperCase() + '</b><br/>' +
        '🌾 ' + g.crops.join(', ') + '<br/>' +
        '📍 ' + g.state + '<br/>' +
        (dist !== null ? '📏 <b>' + dist.toFixed(1) + ' km</b> aapke ghar se<br/>' : '') +
        '⚠ <b>' + g.count + '</b> report' + (g.count > 1 ? 's' : '') + ' is area mein<br/>' +
        (okCount > 0 ? '✅ <b>' + okCount + '</b> farmer' + (okCount>1?'s':'')+' say crop is recovering<br/>' : '') +
        '<span style="color:#888;font-size:11px">🔵 Circle = ' + radiusKm + 'km radius (≈' + areaKm2 + ' sq km)</span>' +
        '</div>';

      // Coverage circle (heatmap effect)
      const circle = L.circle([g.lat, g.lon], {
        radius: radiusKm * 1000,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: Math.min(0.12 + g.count * 0.06, 0.45),
        opacity: 0.7,
      }).bindPopup(popupHtml);
      circle.addTo(map);
      layersRef.current.push(circle);

      // Dot at epicentre
      const dot = L.circleMarker([g.lat, g.lon], {
        radius: Math.min(6 + g.count * 2, 18),
        color: '#0F0A00',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }).bindPopup(popupHtml);
      dot.addTo(map);
      layersRef.current.push(dot);
      allBounds.push([g.lat, g.lon]);
    });

    // User location marker
    if (userLoc) {
      const uDot = L.circleMarker([userLoc.lat, userLoc.lon], {
        radius: 10, color: '#00D4CC', weight: 3, fillColor: '#00D4CC', fillOpacity: 0.95
      }).bindPopup('<b style="color:#00D4CC">📍 AAPKI LOCATION</b>');
      uDot.addTo(map);
      layersRef.current.push(uDot);
      allBounds.push([userLoc.lat, userLoc.lon]);
    }

    // Fit bounds
    if (allBounds.length > 1) {
      try { map.fitBounds(allBounds, { padding: [30, 30], maxZoom: 11 }); } catch(e) {}
    } else if (allBounds.length === 1) {
      map.setView(allBounds[0], 9);
    }
  }, [reports, userLoc, alertThreshold, radiusKm]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) { try { mapInstanceRef.current.remove(); } catch(e){} mapInstanceRef.current = null; }
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100%', height: 320, border: '2px solid #E8650A55', borderRadius: 2 }} />;
}
// ── Outbreak Banner ──────────────────────────────────────────────────────────
function OutbreakBanner({alerts,onDismiss}){
  if(!alerts||!alerts.length) return null;
  return(
    <div style={{marginBottom:12}}>
      {alerts.map((a,i)=>(
        <div key={i} style={{background:"rgba(255,45,85,0.08)",border:"2px solid #FF2D55",padding:"14px",marginBottom:8,position:"relative"}}>
          <div style={{position:"absolute",top:10,right:10,width:10,height:10,borderRadius:"50%",background:"#FF2D55",animation:"pulse 1.2s infinite"}}/>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:"1.3rem"}}>🚨</span>
            <div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.9rem",letterSpacing:".15em",color:"#FF2D55"}}>DISEASE OUTBREAK ALERT</div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",color:"#6B5530"}}>{a.count} FARMS · {RADIUS_KM}KM RADIUS</div>
            </div>
          </div>
          <p style={{fontSize:"0.83rem",color:"#FFAABB",lineHeight:1.75,marginBottom:8}}>
            <strong style={{color:"#FF2D55"}}>{a.disease}</strong> on <strong style={{color:"#FF2D55"}}>{a.count} farm{a.count!==1?"s":""}</strong> near you.
          </p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",color:"#6B5530"}}>CROPS: {a.crops.join(", ")}</span>
            <button onClick={()=>onDismiss(i)} style={{marginLeft:"auto",background:"transparent",border:"1px solid rgba(255,45,85,0.4)",color:"#FF2D55",fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",padding:"3px 10px",cursor:"pointer"}}>DISMISS</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]         = useState("diagnose");
  const [lang,setLang]       = useState(()=>getStateDefaultLang(DEFAULT_STATE));
  const [state,setState]     = useState(DEFAULT_STATE);
  const [crop,setCrop]       = useState("Tomato");
  const [image,setImage]     = useState(null);
  const [imgB64,setImgB64]   = useState(null);
  const [imgMime,setImgMime] = useState("image/jpeg");
  const [loading,setLoading] = useState(false);
  const [diag,setDiag]       = useState(null);
  const [localHistory,setLocalHistory] = useState([]);
  const [voiceScript,setVoiceScript]   = useState(null);
  const [voiceLoading,setVoiceLoading] = useState(false);
  const [comparison,setComparison]     = useState(null);
  const [cmpLoading,setCmpLoading]     = useState(false);
  const [error,setError]     = useState(null);
  const [visible,setVisible] = useState(false);
  const [userLoc,setUserLoc] = useState(null);
  const [locError,setLocError] = useState(null);
  const [locStatus,setLocStatus] = useState("idle"); // idle | requesting | granted | denied | unsupported
  const [outbreakAlerts,setOutbreakAlerts] = useState([]);
  const [sharedReports,setSharedReports]   = useState([]);
  const [myReportFbKey,setMyReportFbKey]   = useState(null);
  const [okVotes,setOkVotes]               = useState({});
  const [dbLoading,setDbLoading] = useState(true);
  const [comboCounts,setComboCounts] = useState({});
  const [proneAlerts,setProneAlerts] = useState([]);
  const [showProneModal,setShowProneModal] = useState(false);
  const sessionShownRef = useRef(new Set());
  const fileRef = useRef();
  const chatEndRef = useRef(null);
  const followUpRef = useRef();
  const simImgRef = useRef();

  const [histSearch,   setHistSearch]   = useState("");
  const [histFilter,   setHistFilter]   = useState("ALL");
  const [selectedRec,  setSelectedRec]  = useState(null);
  const [recStatuses,  setRecStatuses]  = useState({});
  const [recNotes,     setRecNotes]     = useState({});
  const [noteInput,    setNoteInput]    = useState("");
  const [followUpImg,    setFollowUpImg]    = useState(null);
  const [followUpResult, setFollowUpResult] = useState(null);
  const [followUpLoading,setFollowUpLoading]= useState(false);
  const [followUpError,  setFollowUpError]  = useState(null);
  const [showStateExtra, setShowStateExtra] = useState(false);

  const [chatOpen,   setChatOpen]   = useState(false);
  const [chatMsgs,   setChatMsgs]   = useState([{role:"assistant",content:"नमस्ते! मैं KrishiMitra हूँ। अपनी फसल की समस्या बताएं।\n\nHello! I am KrishiMitra. Tell me your crop problem."}]);
  const [chatInput,  setChatInput]  = useState("");
  const [chatBusy,   setChatBusy]   = useState(false);
  const [isListening,setIsListening]= useState(false);
  const [speakingIdx,setSpeakingIdx]= useState(null);
  const recognitionRef = useRef(null);

  const speakText = (text, idx) => {
    window.speechSynthesis.cancel();
    if(speakingIdx===idx){ setSpeakingIdx(null); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang==="hi"?"hi-IN":lang==="mr"?"mr-IN":lang==="ta"?"ta-IN":lang==="te"?"te-IN":lang==="kn"?"kn-IN":lang==="pa"?"pa-IN":lang==="gu"?"gu-IN":lang==="bn"?"bn-IN":"en-IN";
    utt.rate = 0.88;
    utt.onend = ()=>setSpeakingIdx(null);
    utt.onerror = ()=>setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utt);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){ alert("Voice input not supported in this browser."); return; }
    if(isListening){ recognitionRef.current?.stop(); setIsListening(false); return; }
    const rec = new SpeechRecognition();
    rec.lang = lang==="hi"?"hi-IN":lang==="mr"?"mr-IN":lang==="ta"?"ta-IN":lang==="te"?"te-IN":lang==="kn"?"kn-IN":lang==="pa"?"pa-IN":lang==="gu"?"gu-IN":lang==="bn"?"bn-IN":"en-IN";
    rec.interimResults = false;
    rec.onresult = e=>{ setChatInput(e.results[0][0].transcript); setIsListening(false); };
    rec.onend = ()=>setIsListening(false);
    rec.onerror = ()=>setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  const [simCrop,    setSimCrop]    = useState("");
  const [simDisease, setSimDisease] = useState("");
  const [simArea,    setSimArea]    = useState("");
  const [simPriority,setSimPriority]= useState("MAX YIELD SAVED");
  const [simResult,  setSimResult]  = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError,   setSimError]   = useState(null);
  const [simImg,     setSimImg]     = useState(null);
  const [simImgMime, setSimImgMime] = useState("image/jpeg");

  const sendChat = async()=>{
    const text = chatInput.trim();
    if(!text || chatBusy) return;
    const userMsg = {role:"user", content:text};
    const history = [...chatMsgs, userMsg];
    setChatMsgs(history);
    setChatInput("");
    setChatBusy(true);
    try{
      const systemCtx = KRISHIMITRA_SYSTEM_PROMPT + `\n\nFarmer context: State=${state}, Crop=${crop}.`;
      const payload = {
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        max_tokens: 400,
        messages: [
          {role:"system", content: systemCtx},
          ...history.map(m=>({role:m.role, content:m.content}))
        ]
      };
      const res  = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+import.meta.env.VITE_GROQ_KEY},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "माफ करें, कोई जवाब नहीं मिला।";
      setChatMsgs(p=>[...p,{role:"assistant",content:reply}]);
    } catch(e){
      setChatMsgs(p=>[...p,{role:"assistant",content:"Error: "+e.message}]);
    }
    setChatBusy(false);
  };

  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:"smooth"}); },[chatMsgs]);

  const analyzeFollowUp = async(rec) => {
    if(!followUpImg || !rec) return;
    setFollowUpLoading(true); setFollowUpResult(null); setFollowUpError(null);
    try{
      // Extract base64 and mime from data URL
      const [meta, b64] = followUpImg.split(",");
      const mime = meta.match(/:(.*?);/)[1];
      const prompt = `You are an expert agricultural plant pathologist AI performing a follow-up assessment.

ORIGINAL DIAGNOSIS:
- Crop: ${rec.crop}
- Disease: ${rec.disease}
- Severity at diagnosis: ${rec.severity}
- State: ${rec.state || "India"}
- Days since diagnosis: ~7 days
- Treatment applied: ${rec.chemicalTreatment?.pesticide || "unknown"} (chemical), ${rec.organicTreatment || "organic methods"}

Carefully examine the NEW follow-up photo provided. Compare with the original diagnosis and provide a detailed treatment response assessment.

Reply ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "recoveryScore": 72,
  "currentSeverity": "Mild",
  "originalSeverity": "${rec.severity}",
  "affectedAreaNow": "20%",
  "affectedAreaBefore": "65%",
  "improvementPct": 69,
  "trend": "IMPROVING",
  "statusRecommendation": "MONITORING",
  "findings": ["finding 1","finding 2","finding 3"],
  "nextSteps": "2 sentence actionable next step for the farmer.",
  "warningFlag": null
}

trend must be one of: IMPROVING / STABLE / WORSENING
statusRecommendation must be one of: RECOVERED / MONITORING / ONGOING / WORSENING
warningFlag: null if no urgent concern, else a short alert string.`;

      const messages = [{
        role:"user",
        content:[
          {type:"image_url", image_url:{url:`data:${mime};base64,${b64}`}},
          {type:"text", text:prompt}
        ]
      }];
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+import.meta.env.VITE_GROQ_KEY},
        body:JSON.stringify({model:"meta-llama/llama-4-scout-17b-16e-instruct",max_tokens:600,messages})
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error.message);
      const raw = data.choices?.[0]?.message?.content?.trim()||"";
      const jM = raw.match(/\{[\s\S]*\}/);
      if(!jM) throw new Error("No JSON in response");
      const result = JSON.parse(jM[0]);
      setFollowUpResult(result);
      // Auto-update record status
      if(result.statusRecommendation){
        setRecStatuses(p=>({...p,[rec.id]:result.statusRecommendation}));
      }
    } catch(e){ setFollowUpError("Analysis failed: "+e.message); }
    setFollowUpLoading(false);
  };

  const runSimulation = async()=>{
    if(!simCrop||(!simDisease.trim()&&!simImg)||!simArea.trim()) return;
    setSimLoading(true); setSimResult(null); setSimError(null);
    const sd = STATE_AGI_DATA[state]||{};
    try{
      const diseaseNote = simImg && !simDisease.trim()
        ? "DISEASE: Not provided — identify the disease from the uploaded crop image first, then use that identified disease for the simulation."
        : "Disease: " + simDisease;
      const prompt =
        "You are an unbiased agricultural economist advising Indian farmers. Give an HONEST, DATA-DRIVEN comparison between chemical and organic treatments. Do NOT automatically recommend chemical — organic is often better for soil health, market premiums, and long-term yield. Base recommendation ONLY on the actual parameters below.\n\n" +
        "INPUTS:\n" +
        "Crop: " + simCrop + "\n" +
        diseaseNote + "\n" +
        "Farm Area: " + simArea + " acres\n" +
        "Farmer Priority: " + simPriority + "\n" +
        "State: " + state + "\n" +
        "Season: " + (sd.season||"unknown") + "\n" +
        "Soil Type: " + (sd.soil||"mixed") + "\n\n" +
        "EVALUATION CRITERIA (apply ALL honestly):\n" +
        "1. Cost — chemical vs organic total cost per acre\n" +
        "2. Yield Saved % — how much yield does each method actually protect for THIS disease type\n" +
        "3. Time to Control — how many weeks for each\n" +
        "4. Environmental Risk — soil/water damage\n" +
        "5. Market Premium — organic produce fetches 20-40% higher mandi price in India\n" +
        "6. Disease type — viral diseases do NOT respond to chemicals; for fungal, organic is competitive; bacterial may need copper-based\n" +
        "7. Farmer Priority — if priority is ORGANIC PREFERRED or LOW COST, consider organic seriously\n\n" +
        "CRITICAL: If the disease is viral (e.g. leaf curl, mosaic, tungro, grassy shoot), chemical pesticides cannot cure it — reflect ZERO or very low yieldSaved for chemical.\n" +
        "If priority is ORGANIC PREFERRED → recommend organic unless chemical advantage is overwhelming.\n" +
        "If priority is LOW COST → recommend whichever has lower totalCost.\n" +
        "If priority is BALANCED → compare net profit after market premium.\n\n" +
        "Reply ONLY valid JSON, no markdown:\n" +
        '{"detectedDisease":"disease name identified from image or given by user",' +
        '"chemical":{"pesticide":"exact product name","dosage":"X ml/L","costPerAcre":2500,"laborCost":800,"totalCost":3300,"yieldSaved":75,"roi":115,"sprayTiming":"morning/evening","weeks":3,"envRisk":"High","sideEffect":"one impact on soil/water"},' +
        '"organic":{"remedy":"exact remedy name","dosage":"X ml/L or kg/acre","costPerAcre":900,"laborCost":1200,"totalCost":2100,"yieldSaved":65,"roi":95,"sprayTiming":"evening","weeks":5,"envRisk":"Low","benefit":"one long-term soil benefit"},' +
        '"recommendation":"chemical or organic","reasoning":"2 sentences citing specific numbers — cost difference, yield difference, and farmer priority",' +
        '"marketPremiumOrganic":30,"safetyNote":"1 short safety caution","marketNote":"1 sentence on mandi price impact",' +
        '"netProfitChemical":41000,"netProfitOrganic":38000,' +
        '"howCalculated":{"cropValuePerAcre":"e.g. expected yield X mandi price = ₹X per acre","chemicalStep":"Revenue ₹X - chemical cost ₹X - labor ₹X = ₹X per acre x area","organicStep":"Revenue ₹X x 1.30 (mandi premium) - organic cost ₹X - labor ₹X = ₹X per acre x area","yieldNote":"Chemical saves X% yield, organic saves X% yield for this disease type","winner":"Chemical/Organic wins because ... (1 simple sentence farmer can understand)"}}';
      // Build message content — include image if uploaded
      const msgContent = simImg
        ? [{type:"text",text:prompt},{type:"image_url",image_url:{url:`data:${simImgMime};base64,${simImg}`}}]
        : prompt;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+import.meta.env.VITE_GROQ_KEY},
        body:JSON.stringify({model:"meta-llama/llama-4-scout-17b-16e-instruct",max_tokens:1100,messages:[{role:"user",content:msgContent}]})
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error.message);
      const raw = data.choices?.[0]?.message?.content?.trim()||"";
      const jM = raw.match(/\{[\s\S]*\}/);
      if(!jM) throw new Error("No JSON returned");
      const parsed = JSON.parse(jM[0]);
      // If AI detected disease from image and none was typed, show it
      if(parsed.detectedDisease && !simDisease.trim()) setSimDisease(parsed.detectedDisease);
      setSimResult(parsed);
    } catch(e){ setSimError("Simulation failed: "+e.message); }
    setSimLoading(false);
  };

  const requestLocation = () => {
    if(!navigator.geolocation){ setLocStatus("unsupported"); return; }
    setLocStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      p=>{ setUserLoc({lat:p.coords.latitude,lon:p.coords.longitude}); setLocStatus("granted"); },
      ()=>{ setLocError("Location denied"); setLocStatus("denied"); },
      {timeout:10000,enableHighAccuracy:true}
    );
  };

  // Check permission state on mount and act accordingly
  useEffect(()=>{
    if(!navigator.geolocation){ setLocStatus("unsupported"); return; }
    if(navigator.permissions){
      navigator.permissions.query({name:"geolocation"}).then(result=>{
        if(result.state==="granted"){
          setLocStatus("granted");
          navigator.geolocation.getCurrentPosition(
            p=>setUserLoc({lat:p.coords.latitude,lon:p.coords.longitude}),
            ()=>{},{timeout:8000}
          );
        } else if(result.state==="denied"){
          setLocStatus("denied");
        } else {
          // "prompt" — auto-trigger, Chrome will show its native popup
          requestLocation();
        }
        result.onchange = ()=>{
          if(result.state==="granted") requestLocation();
          else if(result.state==="denied") setLocStatus("denied");
        };
      });
    } else {
      // Fallback: just try, browser decides
      requestLocation();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const getDialect = () => (STATE_DIALECT[state]||{dialect:"Hindi"}).dialect;

  useEffect(()=>{
    setTimeout(()=>setVisible(true),60);
    // ── Firebase real-time subscriptions ──
    // 1. Reports — har nayi entry sabke liye live update
    const reportsRef = ref(db, "fasaldoc/reports");
    const unsubReports = onValue(reportsRef, snapshot=>{
      const val = snapshot.val();
      if(val){
        const arr = Object.entries(val).map(([fbKey,r])=>({...r,fbKey}));
        setSharedReports(arr);
        // computeAlerts runs via the userLoc+sharedReports useEffect below
      } else {
        setSharedReports([]);
      }
      setDbLoading(false);
    }, ()=>setDbLoading(false));

    // 2. Combo counts — fires on ALL devices whenever any count changes
    const countsRef = ref(db, "fasaldoc/comboCounts");
    const unsubCounts = onValue(countsRef, snapshot=>{
      const val = snapshot.val();
      if(!val) return;
      setComboCounts(val);
      // Check ALL disease combos for threshold — runs on every connected device
      const alerts=[];
      Object.entries(val).forEach(([key,cnt])=>{
        if(cnt>=PRONE_THRESHOLD){
          const sk="prone:"+key;
          if(!sessionShownRef.current.has(sk)){
            const parts=key.split("|");
            alerts.push({state:parts[0],crop:parts[1],disease:parts[2]||parts[1],count:cnt,fbKey:sk});
            sessionShownRef.current.add(sk);
          }
        }
      });
      if(alerts.length){ setProneAlerts(alerts); setShowProneModal(true); }
    });

    // 3. Prone alerts (legacy push) — still listen so older alerts also show
    const proneRef = ref(db, "fasaldoc/proneAlerts");
    const unsubProne = onValue(proneRef, snapshot=>{
      const val = snapshot.val();
      if(!val) return;
      const cutoff = Date.now() - 24*60*60*1000;
      const incoming = Object.entries(val)
        .map(([fbKey, a])=>({...a, fbKey}))
        .filter(a=> a.ts > cutoff && !sessionShownRef.current.has("pa:"+a.fbKey));
      if(incoming.length){
        incoming.forEach(a=>sessionShownRef.current.add("pa:"+a.fbKey));
        setProneAlerts(p=>[...p,...incoming]);
        setShowProneModal(true);
      }
    });

    // 4. OK Votes — real-time count of "crop is fine" signals
    const unsubOkVotes = onValue(ref(db,"fasaldoc/okVotes"), snap=>{
      setOkVotes(snap.val()||{});
    });

    return ()=>{ unsubReports(); unsubCounts(); unsubProne(); unsubOkVotes(); };
  },[]);

  useEffect(()=>{ if(userLoc&&sharedReports.length) computeAlerts(sharedReports); },[userLoc,sharedReports]);

  const incrementCombo = async(st,cr,disease)=>{
    const key=comboKey(st,cr,disease);
    try{
      const countsRef = ref(db, "fasaldoc/comboCounts");
      const snap = await get(countsRef);
      const prev = snap.val()||{};
      const newCount = (prev[key]||0)+1;
      const next = {...prev,[key]:newCount};
      await set(countsRef, next);
      // If threshold hit → broadcast prone alert to ALL devices via Firebase
      if(newCount>=PRONE_THRESHOLD && newCount%PRONE_THRESHOLD===0){
        await push(ref(db,"fasaldoc/proneAlerts"),{
          state:st, crop:cr, disease, count:newCount, ts:Date.now()
        });
      }
    } catch(e){ console.error("incrementCombo:",e); }
  };

  const saveReport = async(d,lat,lon)=>{
    const id=Date.now()+"-"+Math.random().toString(36).slice(2,6);
    const report={id,disease:d.disease,diseaseKey:norm(d.disease),crop:d.crop,severity:d.severity,state,lat,lon,ts:Date.now(),resolved:false};
    try{
      const res = await push(ref(db,"fasaldoc/reports"), report);
      setMyReportFbKey(res.key);
    } catch(e){ console.error("saveReport:",e); }
  };

  const resolveMyReport = async()=>{
    if(!myReportFbKey) return;
    const myReport = sharedReports.find(r=>r.fbKey===myReportFbKey);
    if(!myReport) return;
    try{
      await set(ref(db,"fasaldoc/reports/"+myReportFbKey),{...myReport,resolved:true});
      setMyReportFbKey(null);
    } catch(e){ console.error("resolveMyReport:",e); }
  };

  const voteOK = async(diseaseKey)=>{
    const lsKey="fasaldoc_ok_"+diseaseKey;
    if(localStorage.getItem(lsKey)) return;
    try{
      const snap = await get(ref(db,"fasaldoc/okVotes/"+diseaseKey));
      await set(ref(db,"fasaldoc/okVotes/"+diseaseKey),(snap.val()||0)+1);
      localStorage.setItem(lsKey,"1");
    } catch(e){ console.error("voteOK:",e); }
  };

  const computeAlerts = useCallback((reports,justSaved=null)=>{
    if(!userLoc) return;
    const groups={};
    reports.forEach(r=>{
      if(!r.lat||!r.lon||r.resolved||haversine(userLoc.lat,userLoc.lon,r.lat,r.lon)>RADIUS_KM||(justSaved&&r.id===justSaved.id)) return;
      const key=r.diseaseKey||norm(r.disease);
      if(!groups[key]) groups[key]={disease:r.disease,count:0,crops:[]};
      groups[key].count++;
      if(!groups[key].crops.includes(r.crop)) groups[key].crops.push(r.crop);
    });
    setOutbreakAlerts(Object.values(groups).filter(g=>g.count>=ALERT_THRESHOLD).sort((a,b)=>b.count-a.count));
  },[userLoc]);

  // Convert Anthropic-style messages to OpenAI/Groq format
  const convertMessages = (messages) => messages.map(msg => ({
    ...msg,
    content: Array.isArray(msg.content)
      ? msg.content.map(part => {
          if(part.type==="image" && part.source) {
            return { type:"image_url", image_url:{ url:`data:${part.source.media_type};base64,${part.source.data}` } };
          }
          return part;
        })
      : msg.content
  }));

  const callAPI = async(messages,max_tokens=3000)=>{
    const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+import.meta.env.VITE_GROQ_KEY},
      body:JSON.stringify({model:"meta-llama/llama-4-scout-17b-16e-instruct",max_tokens,messages:convertMessages(messages)})
    });
    const data=await res.json();
    if(data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content?.trim()||"";
  };

  const diagnoseCrop = async()=>{
    if(!imgB64) return;
    setLoading(true); setError(null); setDiag(null); setVoiceScript(null); setComparison(null);
    try{
      // Validate plant
      const vTxt=await callAPI([{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:imgMime,data:imgB64}},
        {type:"text",text:'Does this image show a plant/crop/leaf/stem/root/fruit? Reply ONLY JSON: {"isPlant":true} or {"isPlant":false}'}
      ]}],60);
      const vM=vTxt.match(/\{[\s\S]*?\}/);
      if(!vM||!JSON.parse(vM[0]).isPlant){ setError("No crop detected. Please upload a clear plant photo."); setLoading(false); return; }

      // Build prompt as plain string concat to avoid template literal issues
      const diagPrompt = (() => {
        const sd = STATE_AGI_DATA[state] || {};
        const langName = LANG_NAMES[lang] || "English";
        const langInstruction = lang==="en"
          ? ""
          : "LANGUAGE RULE: Write ALL text fields (description, symptoms, causes, organicTreatment, soilCare, every sevenDayPlan action, warning, localAvailability) in " + langName + ". Keep disease name, crop name, pesticide names, dosages in English (Roman) script only. Do not translate scientific names.\n\n";
        return "You are an expert plant pathologist AI. Carefully examine the uploaded image and diagnose the disease you ACTUALLY SEE in the photo.\n\n" +
          langInstruction +
          "CRITICAL RULES:\n" +
          "1. Base your diagnosis ONLY on the visual symptoms visible in the image — color, texture, lesion shape, pattern, spread.\n" +
          "2. Do NOT default to the most common disease. Identify EXACTLY what is shown.\n" +
          "3. If the image shows healthy tissue, say so in the disease field.\n" +
          "4. The crop selected is: " + crop + " — but if the image clearly shows a different crop, name it correctly.\n\n" +
          "BACKGROUND CONTEXT (use only for treatment advice, NOT for choosing the disease):\n" +
          "State: " + state + ", Soil: " + (sd.soil||"mixed") + ", Season: " + (sd.season||"unknown") + ", Rainfall: " + (sd.rain||"unknown") + ".\n" +
          "Diseases sometimes found in this region: " + (sd.diseases||[]).join(", ") + " — only mention these if the IMAGE confirms them.\n\n" +
          "Reply ONLY valid JSON, no markdown:\n" +
          '{"crop":"","disease":"","confidence":85,"severity":"Mild|Moderate|Severe","description":"2-3 sentences describing exactly what you see in the image",' +
          '"symptoms":["visible symptom 1","visible symptom 2","visible symptom 3"],"causes":"1 sentence on likely cause based on image",' +
          '"chemicalTreatment":{"pesticide":"","dosage":"","method":"","frequency":""},' +
          '"organicTreatment":"1 sentence","soilCare":"1 sentence relevant to ' + state + '",' +
          '"sevenDayPlan":[{"day":1,"action":""},{"day":2,"action":""},{"day":3,"action":""},{"day":4,"action":""},{"day":5,"action":""},{"day":6,"action":""},{"day":7,"action":"take follow-up photo"}],' +
          '"warning":"1 sentence specific caution for ' + state + '","localAvailability":"where to find treatment in ' + state + '"}';
      })();

      const txt=await callAPI([{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:imgMime,data:imgB64}},
        {type:"text",text:diagPrompt}
      ]}]);
      const jM=txt.match(/\{[\s\S]*\}/);
      if(!jM) throw new Error("No JSON in response.");
      const result=JSON.parse(jM[0]);
      setDiag(result);
      setLocalHistory(p=>[{id:Date.now(),date:new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short"}).toUpperCase(),crop:result.crop,disease:result.disease,severity:result.severity,status:"ONGOING",state,description:result.description,symptoms:result.symptoms||[],chemicalTreatment:result.chemicalTreatment||{},organicTreatment:result.organicTreatment||"",sevenDayPlan:result.sevenDayPlan||[]},...p]);
      await saveReport(result,userLoc?.lat||null,userLoc?.lon||null);
      await incrementCombo(state,crop,result.disease);
    } catch(err){ setError("Analysis failed: "+err.message); }
    setLoading(false);
  };

  const generateVoice = async()=>{
    if(!diag) return;
    setVoiceLoading(true);
    const dialect=getDialect();
    try{
      const prompt = "Write a warm 3-4 sentence spoken advisory in authentic " + dialect + " dialect.\n" +
        "Disease: " + diag.disease + ", severity: " + diag.severity + ", first action: " + (diag.sevenDayPlan?.[0]?.action||"") + ".\n" +
        "Reply ONLY the spoken text, no labels, no quotes, no English.";
      const script=await callAPI([{role:"user",content:prompt}],400);
      setVoiceScript(script);
    } catch{
      setVoiceScript(diag.disease+" found in your "+diag.crop+". Severity: "+diag.severity+". "+( diag.sevenDayPlan?.[0]?.action||"Take immediate action."));
    }
    setVoiceLoading(false);
  };

  const generateComparison = async()=>{
    if(!diag) return;
    setCmpLoading(true);
    try{
      const prompt = "You are an agricultural economist in India.\n" +
        "Crop: " + diag.crop + ", Disease: " + diag.disease + ", Severity: " + diag.severity + ", State: " + state + ".\n" +
        "Chemical treatment: " + (diag.chemicalTreatment?.pesticide||"standard pesticide") + ".\n" +
        "Organic treatment: " + (diag.organicTreatment||"neem oil / biocontrol") + ".\n\n" +
        "Reply ONLY valid JSON (no markdown) with this exact shape:\n" +
        "{\n" +
        '  "chemical": {\n' +
        '    "treatmentCostPerAcre": 2500,\n' +
        '    "laborCostPerAcre": 800,\n' +
        '    "equipmentCostPerAcre": 300,\n' +
        '    "yieldSavedPercent": 75,\n' +
        '    "revenuePerAcre": 45000,\n' +
        '    "netProfitPerAcre": 41400,\n' +
        '    "roi": 1180,\n' +
        '    "effectivenessWeeks": 3,\n' +
        '    "paybackWeeks": 1,\n' +
        '    "envRisk": "High"\n' +
        "  },\n" +
        '  "organic": {\n' +
        '    "treatmentCostPerAcre": 1200,\n' +
        '    "laborCostPerAcre": 1200,\n' +
        '    "equipmentCostPerAcre": 100,\n' +
        '    "yieldSavedPercent": 62,\n' +
        '    "revenuePerAcre": 38000,\n' +
        '    "netProfitPerAcre": 35500,\n' +
        '    "roi": 1420,\n' +
        '    "effectivenessWeeks": 5,\n' +
        '    "paybackWeeks": 2,\n' +
        '    "envRisk": "Low"\n' +
        "  },\n" +
        '  "recommendation": "chemical",\n' +
        '  "reasoning": "2 sentence explanation why one is better for this farmer.",\n' +
        '  "keyAdvantages": ["Faster action","Higher yield protection","Widely available"],\n' +
        '  "marketNote": "1 sentence on mandi prices or organic premium if relevant."\n' +
        "}";

      const txt=await callAPI([{role:"user",content:prompt}],800);
      const jM=txt.match(/\{[\s\S]*\}/);
      if(!jM) throw new Error("No JSON");
      setComparison(JSON.parse(jM[0]));
    } catch(e){ setComparison(null); console.error("comparison error",e); }
    setCmpLoading(false);
  };

  const upload = e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{ const d=ev.target.result; setImage(d); setImgB64(d.split(",")[1]); setImgMime(d.split(";")[0].split(":")[1]||"image/jpeg"); };
    r.readAsDataURL(f);
    setDiag(null); setError(null); setVoiceScript(null); setComparison(null);
  };

  const s=(i)=>({opacity:visible?1:0,transform:visible?"translateY(0)":"translateY(20px)",transition:"opacity .5s ease "+(i*.08)+"s, transform .5s ease "+(i*.08)+"s"});

  const globalGroups=sharedReports.filter(r=>!r.resolved).reduce((acc,r)=>{ const k=r.diseaseKey||norm(r.disease); if(!acc[k]) acc[k]={disease:r.disease,diseaseKey:k,count:0,crops:[],states:[]}; acc[k].count++; if(!acc[k].crops.includes(r.crop)) acc[k].crops.push(r.crop); if(!acc[k].states.includes(r.state)) acc[k].states.push(r.state); return acc; },{});
  const globalList=Object.values(globalGroups).sort((a,b)=>b.count-a.count);

  return(
    <div style={{minHeight:"100vh",fontFamily:"'Baloo 2',sans-serif",color:"#FFF0D0",background:"#0F0A00",overflowX:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Baloo+2:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background-color:#0F0A00;background-image:repeating-linear-gradient(45deg,transparent,transparent 18px,rgba(232,101,10,.04) 18px,rgba(232,101,10,.04) 19px);}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#0F0A00;}::-webkit-scrollbar-thumb{background:#E8650A;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
        .fade-up{animation:fadeUp .35s ease both;}
        select{width:100%;background:#1A1100;border:2px solid #E8650A;color:#FFF0D0;font-family:'Baloo 2',sans-serif;font-size:.88rem;padding:8px 10px;border-radius:0;outline:none;appearance:none;cursor:pointer;}
        select:focus{border-color:#00D4CC;}select option{background:#1A1100;}
        .btn-main{width:100%;background:#E8650A;color:#0F0A00;border:none;padding:15px;font-family:'Bebas Neue',cursive;font-size:1.25rem;letter-spacing:.14em;cursor:pointer;transition:background .2s;display:block;}
        .btn-main:hover{background:#00D4CC;}.btn-main:disabled{opacity:.35;cursor:not-allowed;}
        .btn-ghost{background:transparent;border:2px solid #00D4CC;color:#00D4CC;font-family:'Bebas Neue',cursive;font-size:.75rem;letter-spacing:.15em;padding:5px 14px;cursor:pointer;transition:all .2s;}
        .btn-ghost:hover{background:#00D4CC;color:#0F0A00;}
        .btn-ghost-red{border-color:#FF2D55!important;color:#FF2D55!important;}
        .btn-ghost-red:hover{background:#FF2D55!important;color:#0F0A00!important;}
        .nav-btn{flex:1;background:transparent;border:none;cursor:pointer;padding:13px 0;font-family:'Bebas Neue',cursive;font-size:.72rem;letter-spacing:.12em;color:#6B5530;transition:color .2s;position:relative;}
        .nav-btn.active{color:#FFF0D0;}.nav-btn.active::before{content:'';position:absolute;top:0;left:12%;right:12%;height:3px;background:#E8650A;}
        .tx-row{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(232,101,10,.12);}
        .tx-row:last-child{border-bottom:none;}
      `}</style>

      {showProneModal&&<ProneAreaModal alerts={proneAlerts} onDismiss={()=>{setShowProneModal(false);setProneAlerts([]);}}/>}

      <div style={{maxWidth:480,margin:"0 auto",padding:"0 0 88px"}}>

        {/* ── LOCATION PERMISSION BAR ── */}
        {locStatus!=="granted"&&locStatus!=="unsupported"&&(
          <div style={{background:locStatus==="denied"?"#1A0008":"#120D02",borderBottom:"2px solid "+(locStatus==="denied"?"#FF2D55":"#E8650A"),padding:"9px 16px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:"1.1rem"}}>{locStatus==="denied"?"🔒":"📍"}</span>
            <div style={{flex:1,fontSize:"0.65rem",color:locStatus==="denied"?"#FF8080":"#8A7050",lineHeight:1.5}}>
              {locStatus==="denied"
                ?<>Location blocked. Tap lock icon (🔒) in address bar → <strong style={{color:"#FF2D55"}}>Site settings → Location → Allow</strong>, then tap Retry.</>
                :locStatus==="requesting"
                ?"Waiting for location permission…"
                :"Allow location to see nearby outbreak alerts."}
            </div>
            {locStatus!=="requesting"&&(
              <button onClick={requestLocation} style={{flexShrink:0,background:locStatus==="denied"?"#FF2D55":"#E8650A",border:"none",color:"#0F0A00",fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",letterSpacing:".1em",padding:"6px 12px",cursor:"pointer"}}>
                {locStatus==="denied"?"RETRY":"ALLOW"}
              </button>
            )}
          </div>
        )}

        {/* HEADER */}
        <div style={{padding:"18px 16px 0",position:"relative",overflow:"hidden",...s(0)}}>
          <div style={{position:"absolute",top:-60,right:-80,width:260,height:260,background:"radial-gradient(circle,rgba(232,101,10,.12) 0%,transparent 70%)",pointerEvents:"none"}}/>
          <div style={{position:"relative",zIndex:1,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:"0.25em",color:"#6B5530",marginBottom:4}}>DIGITAL CROP DIAGNOSIS · INDIA</div>
              <div style={{display:"flex",alignItems:"baseline",lineHeight:0.9}}>
                <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"3.4rem",color:"#E8650A"}}>FASAL</span>
                <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"3.4rem",color:"#FFF0D0"}}>DOC</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:userLoc?"#00D4CC":locError?"#FF2D55":"#6B5530",animation:userLoc?"none":"pulse 1.5s infinite"}}/>
                <span style={{fontSize:"0.62rem",color:userLoc?"#00D4CC":locError?"#FF2D55":"#6B5530",fontFamily:"'Bebas Neue',cursive",letterSpacing:".1em"}}>
                  {userLoc?"GPS ACTIVE":locError?"NO GPS · ALERTS DISABLED":"LOCATING…"}
                </span>
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3,maxWidth:138,justifyContent:"flex-end",paddingTop:6}}>
              {LANGUAGES.map(l=>(
                <button key={l.code} onClick={()=>{setLang(l.code);setDiag(null);setVoiceScript(null);setComparison(null);}} style={{background:lang===l.code?"#E8650A":"#1A1100",color:lang===l.code?"#0F0A00":"#6B5530",border:lang===l.code?"2px solid #E8650A":"2px solid #2E2010",fontFamily:"'Baloo 2',sans-serif",fontSize:"0.68rem",padding:"2px 6px",cursor:"pointer",borderRadius:0,fontWeight:700,transition:"all .15s"}}>{l.native}</button>
              ))}
            </div>
          </div>
          <div style={{height:3,background:"linear-gradient(90deg,#E8650A,#00D4CC,transparent)",marginTop:14,marginLeft:-16,marginRight:-16}}/>
        </div>

        {/* SELECTS */}
        <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,...s(1)}}>
          <div>
            <Strip style={{marginBottom:5,fontSize:"0.58rem"}}>📍 STATE</Strip>
            <select value={state} onChange={e=>{const ns=e.target.value;setState(ns);setVoiceScript(null);setLang(getStateDefaultLang(ns));}}>{STATES.map(st=><option key={st}>{st}</option>)}</select>
          </div>
          <div>
            <Strip bg="#00D4CC" style={{marginBottom:5,fontSize:"0.58rem"}}>🌾 CROP</Strip>
            <select value={crop} onChange={e=>setCrop(e.target.value)}>{CROPS.map(c=><option key={c}>{c}</option>)}</select>
          </div>
        </div>

        {/* TABS */}
        <div style={{display:"flex",borderTop:"3px solid #1E1408",borderBottom:"3px solid #1E1408",background:"#120D02",marginTop:6,...s(2)}}>
          {[["diagnose","DIAGNOSE"],["outbreak","OUTBREAK"+(outbreakAlerts.length?" 🚨":"")],["history","HISTORY"],["simulate","🧪 SIM"],["mystate","MY STATE"]].map(([t,l])=>(
            <button key={t} className={"nav-btn "+(tab===t?"active":"")} onClick={()=>setTab(t)}
              style={{color:t==="outbreak"&&outbreakAlerts.length&&tab!==t?"#FF2D55":""}}>{l}</button>
          ))}
        </div>

        <div style={{padding:"14px 16px 0"}}>

          {/* ══ DIAGNOSE ══ */}
          {tab==="diagnose"&&(
            <div className="fade-up">
              <OutbreakBanner alerts={outbreakAlerts} onDismiss={i=>setOutbreakAlerts(p=>p.filter((_,j)=>j!==i))}/>

              {!diag&&!loading&&(
                <>
                  <Panel accent="#E8650A" style={{marginBottom:10,cursor:"pointer"}} onClick={()=>fileRef.current?.click()}>
                    <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={upload} capture="environment"/>
                    {image?(
                      <div style={{position:"relative"}}>
                        <img src={image} alt="" style={{width:"100%",maxHeight:220,objectFit:"cover",display:"block"}}/>
                        <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(15,10,0,.88))",padding:"22px 14px 10px"}}>
                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".22em",color:"#00D4CC"}}>TAP TO REPLACE</div>
                        </div>
                      </div>
                    ):(
                      <div style={{padding:"34px 20px",textAlign:"center"}}>
                        <div style={{fontSize:"2.8rem",marginBottom:12}}>📷</div>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.5rem",letterSpacing:".1em",color:"#FFF0D0",marginBottom:6}}>CAPTURE SPECIMEN</div>
                        <div style={{fontSize:"0.78rem",color:"#6B5530",lineHeight:1.65}}>Close-up of diseased leaf, stem, or fruit.<br/>Good light · 60%+ crop in frame.</div>
                      </div>
                    )}
                  </Panel>
                  {image&&<>
                    {lang!=="en"&&<div style={{fontSize:"0.68rem",color:"#E8650A",textAlign:"center",marginBottom:6,fontFamily:"'Baloo 2',sans-serif"}}>🌐 Result will be in <b>{LANG_NAMES[lang]}</b></div>}
                    <button className="btn-main" onClick={diagnoseCrop}>⬡ RUN DIAGNOSIS ⬡</button>
                  </>}
                </>
              )}

              {loading&&(
                <Panel accent="#00D4CC" style={{padding:"36px 0",textAlign:"center"}}>
                  <div style={{display:"inline-block",width:38,height:38,border:"3px solid rgba(0,212,204,.2)",borderTop:"3px solid #00D4CC",borderRadius:"50%",animation:"spin .85s linear infinite",marginBottom:14}}/>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",letterSpacing:".18em",color:"#00D4CC"}}>SCANNING SPECIMEN…</div>
                </Panel>
              )}

              {error&&(
                <Panel accent="#FF2D55" style={{padding:18}}>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1rem",color:"#FF2D55",letterSpacing:".12em",marginBottom:6}}>⚠ ERROR</div>
                  <p style={{fontSize:"0.81rem",color:"#A08070",lineHeight:1.65,marginBottom:12}}>{error}</p>
                  <button className="btn-ghost btn-ghost-red" onClick={()=>setError(null)}>RETRY</button>
                </Panel>
              )}

              {diag&&(
                <div>
                  {/* Result card */}
                  <Panel accent={SEV_CLR[diag.severity]||"#E8650A"} style={{marginBottom:10}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 96px"}}>
                      <div style={{padding:"14px 14px 14px 16px",borderRight:"2px solid "+(SEV_CLR[diag.severity]||"#E8650A")}}>
                        <Strip bg={SEV_CLR[diag.severity]||"#E8650A"} color="#0F0A00" style={{marginBottom:10,fontSize:"0.6rem"}}>PATHOLOGY REPORT</Strip>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.75rem",letterSpacing:".05em",color:"#FFF0D0",lineHeight:1.1,marginBottom:5}}>{diag.disease}</div>
                        <div style={{fontSize:"0.76rem",color:"#6B5530",marginBottom:10}}>{diag.crop} · {state}</div>
                        <p style={{fontSize:"0.81rem",color:"#C8B090",lineHeight:1.72}}>{diag.description}</p>
                        <VoicePanel script={voiceScript} loading={voiceLoading} onGenerate={generateVoice} dialect={getDialect()}/>
                      </div>
                      <div style={{padding:"14px 10px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6}}>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"2.6rem",color:SEV_CLR[diag.severity]||"#E8650A",lineHeight:1,textAlign:"center"}}>
                          <Ticker value={diag.confidence}/>%
                        </div>
                        <div style={{fontSize:"0.58rem",letterSpacing:".12em",color:"#6B5530",textAlign:"center"}}>CONFIDENCE</div>
                        <div style={{width:"100%",height:3,background:"#1E1408"}}>
                          <div style={{height:"100%",background:SEV_CLR[diag.severity]||"#E8650A",width:diag.confidence+"%",transition:"width 1.2s ease .3s"}}/>
                        </div>
                        <SevBadge severity={diag.severity}/>
                      </div>
                    </div>
                  </Panel>

                  {/* Symptoms */}
                  <Panel accent="#2E2010" style={{marginBottom:10,padding:"14px 16px"}}>
                    <Strip style={{marginBottom:10}}>SYMPTOMS & CAUSE</Strip>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
                      {(diag.symptoms||[]).map((sym,i)=>(
                        <span key={i} style={{background:"rgba(232,101,10,.1)",border:"1px solid rgba(232,101,10,.35)",color:"#E8A870",padding:"3px 10px",fontSize:"0.76rem"}}>{sym}</span>
                      ))}
                    </div>
                    <div style={{borderLeft:"3px solid #00D4CC",paddingLeft:12,fontSize:"0.81rem",color:"#A08070",lineHeight:1.7}}>
                      <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",color:"#00D4CC"}}>CAUSE: </span>{diag.causes}
                    </div>
                  </Panel>

                  {/* Treatment */}
                  <Panel accent="#2E2010" style={{marginBottom:10,padding:"14px 16px"}}>
                    <Strip style={{marginBottom:12}}>TREATMENT PROTOCOL</Strip>
                    <div style={{borderLeft:"3px solid #E8650A",paddingLeft:12,marginBottom:12}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".15em",color:"#E8650A",marginBottom:4}}>CHEMICAL</div>
                      <div style={{fontFamily:"'Baloo 2',sans-serif",fontSize:"0.95rem",fontWeight:700,color:"#FFF0D0",marginBottom:4}}>{diag.chemicalTreatment?.pesticide}</div>
                      <div style={{fontSize:"0.8rem",color:"#A08070",lineHeight:1.8}}>
                        <div>Dosage: {diag.chemicalTreatment?.dosage}</div>
                        <div>Method: {diag.chemicalTreatment?.method}</div>
                        <div>Frequency: {diag.chemicalTreatment?.frequency}</div>
                      </div>
                    </div>
                    <div style={{borderLeft:"3px solid #00D4CC",paddingLeft:12,marginBottom:12}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".15em",color:"#00D4CC",marginBottom:4}}>ORGANIC</div>
                      <div style={{fontSize:"0.8rem",color:"#A08070",lineHeight:1.7}}>{diag.organicTreatment}</div>
                    </div>
                    <div style={{borderLeft:"3px solid #7B9E4A",paddingLeft:12}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".15em",color:"#7B9E4A",marginBottom:4}}>SOIL</div>
                      <div style={{fontSize:"0.8rem",color:"#A08070",lineHeight:1.7}}>{diag.soilCare}</div>
                    </div>

                    {/* ── Cost & Yield Comparison inline ── */}
                    <TreatmentComparison comparison={comparison} loading={cmpLoading} onGenerate={generateComparison}/>
                  </Panel>

                  {/* 7-day plan */}
                  <Panel accent="#2E2010" style={{marginBottom:10,padding:"14px 16px"}}>
                    <Strip style={{marginBottom:12}}>7-DAY RECOVERY PLAN</Strip>
                    {(diag.sevenDayPlan||[]).map((item,i)=>(
                      <div key={item.day} className="tx-row">
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.75rem",minWidth:34,textAlign:"center",padding:"2px 4px",flexShrink:0,marginTop:3,background:i===0?"#E8650A":"#1E1408",color:i===0?"#0F0A00":"#6B5530"}}>D{item.day}</div>
                        <div style={{fontSize:"0.8rem",color:"#C8B090",lineHeight:1.65}}>{item.action}</div>
                      </div>
                    ))}
                  </Panel>

                  {diag.warning&&(
                    <Panel accent="#FF2D55" style={{marginBottom:10,padding:"14px 16px"}}>
                      <Strip bg="#FF2D55" style={{marginBottom:10}}>⚠ REGIONAL ADVISORY</Strip>
                      <p style={{fontSize:"0.8rem",color:"#FFAABB",lineHeight:1.7}}>{diag.warning}</p>
                    </Panel>
                  )}
                  {diag.localAvailability&&(
                    <Panel accent="#2E2010" style={{marginBottom:12,padding:"14px 16px"}}>
                      <Strip bg="#00D4CC" color="#0F0A00" style={{marginBottom:10}}>🏪 LOCAL PROCUREMENT</Strip>
                      <p style={{fontSize:"0.8rem",color:"#A08070",lineHeight:1.7}}>{diag.localAvailability}</p>
                    </Panel>
                  )}

                  {myReportFbKey&&(
                    <Panel accent="#00D4CC" style={{marginBottom:10,padding:"14px 16px"}}>
                      <Strip bg="#00D4CC" color="#0F0A00" style={{marginBottom:10}}>🌾 CROP RECOVERY UPDATE</Strip>
                      <p style={{fontSize:"0.78rem",color:"#A0D0C0",lineHeight:1.6,marginBottom:12}}>Has your crop recovered? Marking it resolved removes your circle from the outbreak map and helps other farmers know the threat has passed.</p>
                      <button onClick={resolveMyReport} style={{width:"100%",background:"#00D4CC",border:"none",color:"#0F0A00",fontFamily:"'Bebas Neue',cursive",fontSize:"0.95rem",letterSpacing:".12em",padding:"11px",cursor:"pointer"}}>✅ MY CROP IS FINE — MARK RESOLVED</button>
                    </Panel>
                  )}

                  <button className="btn-main" onClick={()=>{setDiag(null);setImage(null);setImgB64(null);setVoiceScript(null);setComparison(null);}}>+ NEW SPECIMEN</button>
                </div>
              )}
            </div>
          )}

          {/* ══ OUTBREAK ══ */}
          {tab==="outbreak"&&(
            <div className="fade-up">
              {outbreakAlerts.length>0&&<><Strip bg="#FF2D55" style={{marginBottom:10}}>🚨 ACTIVE ALERTS NEAR YOU</Strip><OutbreakBanner alerts={outbreakAlerts} onDismiss={i=>setOutbreakAlerts(p=>p.filter((_,j)=>j!==i))}/></>}
              {!outbreakAlerts.length&&(
                <Panel accent="#00D4CC" style={{padding:"14px 16px",marginBottom:14,textAlign:"center"}}>
                  <div style={{fontSize:"1.4rem",marginBottom:6}}>✅</div>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",color:"#00D4CC"}}>{userLoc?"NO OUTBREAKS WITHIN 5KM":"ENABLE GPS FOR LOCAL ALERTS"}</div>
                </Panel>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                {[["REPORTS",sharedReports.length,"#E8650A"],["DISEASES",Object.keys(globalGroups).length,"#00D4CC"],["NEAR YOU",outbreakAlerts.length,"#FF2D55"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"#120D02",border:"2px solid "+c+"22",padding:"12px 8px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.8rem",color:c,lineHeight:1}}>{v}</div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.52rem",color:"#6B5530",marginTop:3}}>{l}</div>
                  </div>
                ))}
              </div>

              {/* ── LIVE HEATMAP ── */}
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <Strip style={{margin:0}}>🗺 LIVE OUTBREAK MAP</Strip>
                  <div style={{fontSize:"0.6rem",color:"#6B5530",fontFamily:"'Bebas Neue',cursive",letterSpacing:".08em"}}>TAP CIRCLE FOR DETAILS</div>
                </div>
                <div style={{fontSize:"0.65rem",color:"#4A3820",marginBottom:8,display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#FF2D55",marginRight:4}}/>Severe</span>
                  <span><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#E8650A",marginRight:4}}/>Alert</span>
                  <span><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#E8A020",marginRight:4}}/>Moderate</span>
                  <span><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#00D4CC",marginRight:4}}/>Your location</span>
                </div>
                {userLoc || sharedReports.some(r=>r.lat&&r.lon) ? (
                  <OutbreakMap reports={sharedReports} userLoc={userLoc} alertThreshold={ALERT_THRESHOLD} radiusKm={RADIUS_KM} okVotes={okVotes}/>
                ) : null}
                {!userLoc&&(
                  <div style={{border:"2px solid #2E2010",padding:"22px 16px",textAlign:"center",marginTop: userLoc||sharedReports.some(r=>r.lat&&r.lon)?8:0}}>
                    <div style={{fontSize:"2rem",marginBottom:8}}>📍</div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",color:"#FFF0D0",marginBottom:4}}>ENABLE LOCATION</div>
                    <div style={{fontSize:"0.7rem",color:"#6B5530",lineHeight:1.6,marginBottom:14}}>Tap the button below — Chrome will ask for permission.<br/>Allow it to see your location on the map.</div>
                    {locStatus==="denied"&&(
                      <div style={{fontSize:"0.68rem",color:"#FF6B6B",lineHeight:1.6,marginBottom:12,padding:"8px",border:"1px solid #FF2D5544",background:"#1A0008"}}>
                        Location was blocked. Tap the <strong style={{color:"#FF2D55"}}>🔒 lock icon</strong> in Chrome's address bar → <strong style={{color:"#FF2D55"}}>Site settings</strong> → <strong style={{color:"#FF2D55"}}>Location → Allow</strong>, then tap Retry.
                      </div>
                    )}
                    {locStatus==="requesting" ? (
                      <div style={{fontFamily:"'Bebas Neue',cursive",color:"#E8A020",fontSize:"0.8rem",letterSpacing:".1em"}}>⏳ Waiting for your response…</div>
                    ) : (
                      <button onClick={requestLocation} style={{background:"#E8650A",border:"none",color:"#0F0A00",fontFamily:"'Bebas Neue',cursive",fontSize:"1rem",letterSpacing:".12em",padding:"12px 32px",cursor:"pointer",width:"100%"}}>
                        {locStatus==="denied"?"🔄 RETRY":"📍 ENABLE LOCATION"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <Panel accent="#2E2010" style={{padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <Strip>GLOBAL TRACKER</Strip>
                  <button className="btn-ghost" onClick={()=>computeAlerts(sharedReports)} style={{fontSize:"0.6rem",padding:"3px 10px"}}>{dbLoading?"…":"↻ SYNC"}</button>
                </div>
                {dbLoading?<div style={{textAlign:"center",padding:"20px 0",color:"#6B5530",fontFamily:"'Bebas Neue',cursive",fontSize:"0.8rem"}}>LOADING…</div>
                :!globalList.length?<div style={{textAlign:"center",padding:"20px 0",color:"#4A3820",fontFamily:"'Bebas Neue',cursive",fontSize:"0.75rem"}}>NO REPORTS YET</div>
                :globalList.map((d,i)=>{
                  const isAlert=d.count>ALERT_THRESHOLD, c=isAlert?"#FF2D55":SEV_CLR["Moderate"];
                  const okCount=okVotes[d.diseaseKey]||0;
                  const isCalming=okCount>0&&okCount>=d.count/2;
                  const ringColor=isCalming?"#888888":c;
                  const alreadyVoted=!!localStorage.getItem("fasaldoc_ok_"+(d.diseaseKey||d.disease));
                  return(
                    <div key={i} style={{padding:"10px 0",borderBottom:i<globalList.length-1?"1px solid rgba(232,101,10,.1)":"none"}}>
                      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:okCount>0?6:0}}>
                        <div style={{width:42,height:42,borderRadius:"50%",border:"3px solid "+ringColor,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",color:ringColor}}>{d.count}</span>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                            <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",color:isCalming?"#888888":"#FFF0D0"}}>{d.disease}</span>
                            {isAlert&&!isCalming&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.55rem",color:"#FF2D55",border:"1px solid #FF2D55",padding:"1px 5px"}}>ALERT</span>}
                            {isCalming&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.55rem",color:"#00D4CC",border:"1px solid #00D4CC",padding:"1px 5px"}}>RECOVERING</span>}
                          </div>
                          <div style={{fontSize:"0.68rem",color:"#6B5530",marginBottom:5}}>{d.crops.join(", ")} · {d.states.join(", ")}</div>
                          <div style={{height:3,background:"#1E1408",borderRadius:2}}>
                            <div style={{height:"100%",background:ringColor,width:(d.count/Math.max(globalList[0].count,1)*100)+"%",borderRadius:2}}/>
                          </div>
                        </div>
                      </div>
                      {okCount>0&&(
                        <div style={{fontSize:"0.62rem",color:"#00D4CC",marginLeft:54,marginBottom:4}}>✅ {okCount} farmer{okCount>1?"s":""} reported crop is recovering</div>
                      )}
                      <div style={{marginLeft:54}}>
                        <button
                          onClick={()=>voteOK(d.diseaseKey||norm(d.disease))}
                          disabled={alreadyVoted}
                          style={{fontSize:"0.6rem",fontFamily:"'Bebas Neue',cursive",letterSpacing:".08em",padding:"4px 10px",border:"1px solid "+(alreadyVoted?"#4A3820":"#00D4CC"),background:"transparent",color:alreadyVoted?"#4A3820":"#00D4CC",cursor:alreadyVoted?"default":"pointer"}}>
                          {alreadyVoted?"✅ VOTED — CROP OK":"🌾 CROP IS OK IN MY AREA"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </Panel>
            </div>
          )}

          {/* ══ HISTORY ══ */}
          {tab==="history"&&(()=>{
            const statuses = recStatuses;
            const filtered = localHistory
              .filter(h=>{
                const st = statuses[h.id]||h.status;
                if(histFilter!=="ALL" && st!==histFilter) return false;
                if(histSearch.trim()){
                  const q=histSearch.toLowerCase();
                  return h.disease?.toLowerCase().includes(q)||h.crop?.toLowerCase().includes(q);
                }
                return true;
              });
            const total   = localHistory.length;
            const ongoing  = localHistory.filter(h=>(statuses[h.id]||h.status)==="ONGOING").length;
            const recovered= localHistory.filter(h=>(statuses[h.id]||h.status)==="RECOVERED").length;
            const severe   = localHistory.filter(h=>h.severity==="Severe").length;
            const SEV_COLOR={Mild:"#00D4CC",Moderate:"#E8A020",Severe:"#FF2D55"};
            const ST_COLOR ={ONGOING:"#FF2D55",MONITORING:"#E8A020",RECOVERED:"#00D4CC",WORSENED:"#FF2D55"};
            return(
              <div className="fade-up">
                {/* Stats row */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:12}}>
                  {[[total,"TOTAL","#E8650A"],[ongoing,"ONGOING","#FF2D55"],[recovered,"RECOVERED","#00D4CC"],[severe,"SEVERE","#FF2D55"]].map(([v,l,c])=>(
                    <div key={l} style={{border:"2px solid "+c,background:"#120D02",padding:"10px 0",textAlign:"center"}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.9rem",color:c,lineHeight:1}}>{v}</div>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.55rem",color:"#6B5530",letterSpacing:".12em",marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>

                {/* Search */}
                <div style={{display:"flex",alignItems:"center",gap:8,background:"#120D02",border:"2px solid #2E2010",padding:"9px 12px",marginBottom:10}}>
                  <span style={{fontSize:"1rem"}}>🔍</span>
                  <input value={histSearch} onChange={e=>setHistSearch(e.target.value)} placeholder="Search disease or crop..."
                    style={{flex:1,background:"transparent",border:"none",color:"#FFF0D0",fontFamily:"'Baloo 2',sans-serif",fontSize:"0.82rem",outline:"none"}}/>
                </div>

                {/* Filter chips */}
                <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                  {["ALL","ONGOING","MONITORING","RECOVERED","WORSENED"].map(f=>(
                    <button key={f} onClick={()=>setHistFilter(f)}
                      style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.68rem",letterSpacing:".1em",padding:"4px 10px",cursor:"pointer",border:"2px solid "+(histFilter===f?({ALL:"#FFF0D0",ONGOING:"#FF2D55",MONITORING:"#E8A020",RECOVERED:"#00D4CC",WORSENED:"#FF2D55"}[f]):"#2E2010"),background:"transparent",color:histFilter===f?({ALL:"#FFF0D0",ONGOING:"#FF2D55",MONITORING:"#E8A020",RECOVERED:"#00D4CC",WORSENED:"#FF2D55"}[f]):"#6B5530"}}>
                      {f}
                    </button>
                  ))}
                </div>

                {/* Cards */}
                {!filtered.length?(
                  <Panel accent="#2E2010" style={{padding:"28px",textAlign:"center"}}>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.8rem",color:"#4A3820"}}>{localHistory.length?"NO RECORDS MATCH FILTER":"NO DIAGNOSES YET THIS SESSION"}</div>
                  </Panel>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {filtered.map(h=>{
                      const st=recStatuses[h.id]||h.status;
                      const sc=ST_COLOR[st]||"#6B5530";
                      const svc=SEV_COLOR[h.severity]||"#6B5530";
                      return(
                        <div key={h.id} onClick={()=>{setSelectedRec(h);setNoteInput("");setFollowUpImg(null);setFollowUpResult(null);setFollowUpError(null);}}
                          style={{background:"#120D02",border:"2px solid #2E2010",padding:"12px 14px",cursor:"pointer",transition:"border-color .2s"}}
                          onMouseEnter={e=>e.currentTarget.style.borderColor="#E8650A"}
                          onMouseLeave={e=>e.currentTarget.style.borderColor="#2E2010"}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                            <div>
                              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.05rem",letterSpacing:".1em",color:"#FFF0D0"}}>{h.disease?.toUpperCase()}</div>
                              <div style={{fontSize:"0.7rem",color:"#6B5530",marginTop:1}}>{h.crop} · {h.state} · {h.date}</div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end",flexShrink:0}}>
                              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".1em",padding:"2px 7px",border:"1.5px solid "+svc,color:svc}}>{h.severity?.toUpperCase()}</div>
                              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".1em",padding:"2px 7px",border:"1.5px solid "+sc,color:sc}}>{st}</div>
                            </div>
                          </div>
                          <div style={{marginTop:8,fontSize:"0.72rem",color:"#6B5530"}}>
                            <span style={{color:"#E8650A",marginRight:4}}>💊</span>
                            <span style={{color:"#6B5530"}}>RX: </span>
                            <span style={{color:"#FFF0D0",fontWeight:600}}>{h.chemicalTreatment?.pesticide||"—"}</span>
                          </div>
                          <div style={{marginTop:7,fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".12em",color:"#E8650A"}}>TAP FOR FULL MEDICAL FILE →</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── MEDICAL FILE MODAL ── */}
                {selectedRec&&(()=>{
                  const h=selectedRec;
                  const st=recStatuses[h.id]||h.status;
                  const notes=recNotes[h.id]||[];
                  return(
                    <div style={{position:"fixed",inset:0,zIndex:300,overflowY:"auto",background:"rgba(0,0,0,.85)"}}>
                      <div style={{maxWidth:480,margin:"0 auto",minHeight:"100vh",background:"#0F0A00",border:"2px solid #E8650A",position:"relative"}}>
                        {/* Modal header */}
                        <div style={{background:"#E8650A",padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10}}>
                          <div>
                            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1rem",letterSpacing:".1em",color:"#0F0A00"}}>🌾 CROP MEDICAL FILE</div>
                            <div style={{fontSize:"0.68rem",color:"#0F0A00",opacity:.8}}>{h.crop} · {h.state} · {h.date}</div>
                          </div>
                          <button onClick={()=>setSelectedRec(null)} style={{background:"rgba(0,0,0,.25)",border:"none",color:"#0F0A00",fontSize:"1.2rem",width:34,height:34,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold"}}>✕</button>
                        </div>

                        <div style={{padding:"14px 14px 40px"}}>
                          {/* Disease info panel */}
                          <Panel accent="#E8650A" style={{marginBottom:12}}>
                            <div style={{padding:"12px 14px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.5rem",letterSpacing:".08em",color:"#FFF0D0"}}>{h.disease?.toUpperCase()}</div>
                                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"2px 8px",border:"1.5px solid "+(SEV_COLOR[h.severity]||"#6B5530"),color:SEV_COLOR[h.severity]||"#6B5530"}}>{h.severity?.toUpperCase()}</div>
                                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"2px 8px",border:"1.5px solid "+(ST_COLOR[st]||"#6B5530"),color:ST_COLOR[st]||"#6B5530"}}>{st}</div>
                                </div>
                              </div>
                              <div style={{fontSize:"0.75rem",color:"#B8902A",lineHeight:1.6}}>{h.description||""}</div>
                            </div>
                          </Panel>

                          {/* Symptoms */}
                          {h.symptoms?.length>0&&(
                            <div style={{marginBottom:12}}>
                              <Strip style={{marginBottom:8,fontSize:"0.6rem"}}>🔬 SYMPTOMS OBSERVED</Strip>
                              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                {h.symptoms.map((s,i)=>(
                                  <span key={i} style={{fontFamily:"'Baloo 2',sans-serif",fontSize:"0.74rem",padding:"4px 10px",border:"1.5px solid #2E2010",color:"#FFF0D0",background:"#120D02"}}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Treatment */}
                          <div style={{marginBottom:12}}>
                            <Strip bg="#E8650A" style={{marginBottom:8,fontSize:"0.6rem"}}>💊 TREATMENT PRESCRIBED</Strip>
                            <div style={{background:"#120D02",border:"2px solid #2E2010",padding:"12px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                              <div style={{borderLeft:"3px solid #E8650A",paddingLeft:10}}>
                                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".12em",color:"#E8650A",marginBottom:5}}>CHEMICAL</div>
                                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1rem",color:"#FFF0D0",marginBottom:4}}>{h.chemicalTreatment?.pesticide||"—"}</div>
                                <div style={{fontSize:"0.7rem",color:"#6B5530"}}>Dose: {h.chemicalTreatment?.dosage||"—"}</div>
                                <div style={{fontSize:"0.7rem",color:"#6B5530"}}>Freq: {h.chemicalTreatment?.frequency||"—"}</div>
                              </div>
                              <div style={{borderLeft:"3px solid #00D4CC",paddingLeft:10}}>
                                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".12em",color:"#00D4CC",marginBottom:5}}>ORGANIC</div>
                                <div style={{fontSize:"0.76rem",color:"#B8F0E0",lineHeight:1.6}}>{h.organicTreatment||"—"}</div>
                              </div>
                            </div>
                          </div>

                          {/* 7-Day Plan */}
                          {h.sevenDayPlan?.length>0&&(
                            <div style={{marginBottom:12}}>
                              <Strip bg="#7B9E4A" style={{marginBottom:8,fontSize:"0.6rem"}}>📅 7-DAY RECOVERY PLAN</Strip>
                              <div style={{background:"#120D02",border:"2px solid #2E2010"}}>
                                {h.sevenDayPlan.map((p,i)=>(
                                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:i<h.sevenDayPlan.length-1?"1px solid rgba(255,255,255,.05)":"none"}}>
                                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.75rem",minWidth:28,color:i===0?"#0F0A00":"#6B5530",background:i===0?"#E8650A":"transparent",padding:i===0?"2px 4px":"0",textAlign:"center"}}>0{p.day||i+1}</div>
                                    <div style={{fontSize:"0.78rem",color:i===0?"#FFF0D0":"#B8902A"}}>{p.action}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Farmer's Notes */}
                          <div style={{marginBottom:12}}>
                            <Strip bg="#E8650A" style={{marginBottom:8,fontSize:"0.6rem"}}>📝 FARMER'S NOTES</Strip>
                            <div style={{background:"#120D02",border:"2px solid #2E2010",padding:"10px 12px"}}>
                              {notes.length===0&&<div style={{fontSize:"0.72rem",color:"#4A3820",fontStyle:"italic",marginBottom:8}}>No notes added yet...</div>}
                              {notes.map((n,i)=>(
                                <div key={i} style={{fontSize:"0.72rem",color:"#B8902A",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>{n}</div>
                              ))}
                              <textarea value={noteInput} onChange={e=>setNoteInput(e.target.value)} placeholder="Write today's observation..."
                                style={{width:"100%",background:"#0F0A00",border:"1px solid #2E2010",color:"#FFF0D0",fontFamily:"'Baloo 2',sans-serif",fontSize:"0.78rem",padding:"8px",marginTop:8,resize:"vertical",minHeight:72,outline:"none"}}/>
                              <div style={{display:"flex",gap:8,marginTop:8}}>
                                <button className="btn-main" style={{flex:1,padding:"9px",fontSize:"0.8rem"}} onClick={()=>{
                                  if(noteInput.trim()){ setRecNotes(p=>({...p,[h.id]:[...(p[h.id]||[]),noteInput.trim()]})); setNoteInput(""); }
                                }}>💾 SAVE UPDATE</button>
                                <select value={st} onChange={e=>setRecStatuses(p=>({...p,[h.id]:e.target.value}))}
                                  style={{background:"#1A1100",border:"2px solid #E8650A",color:"#FFF0D0",fontFamily:"'Bebas Neue',cursive",fontSize:"0.8rem",padding:"0 8px",cursor:"pointer",outline:"none"}}>
                                  {["ONGOING","MONITORING","RECOVERED","WORSENED"].map(o=><option key={o}>{o}</option>)}
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Follow-up scan */}
                          <Panel accent="#7B5EA7" style={{marginBottom:0}}>
                            <div style={{padding:"12px 14px"}}>
                              <Strip bg="#7B5EA7" style={{marginBottom:8,fontSize:"0.6rem"}}>📷 FOLLOW-UP SCAN</Strip>
                              <div style={{fontSize:"0.74rem",color:"#B8A0D0",marginBottom:10}}>Upload a new photo — AI will assess how much the treatment has worked.</div>
                              <input ref={followUpRef} type="file" accept="image/*" style={{display:"none"}} capture="environment"
                                onChange={e=>{
                                  const f=e.target.files[0];
                                  if(f){
                                    const r=new FileReader();
                                    r.onload=ev=>{setFollowUpImg(ev.target.result);setFollowUpResult(null);setFollowUpError(null);};
                                    r.readAsDataURL(f);
                                  }
                                }}/>
                              {followUpImg&&<img src={followUpImg} alt="" style={{width:"100%",maxHeight:180,objectFit:"cover",marginBottom:8,border:"2px solid #7B5EA7",borderRadius:4}}/>}
                              <div style={{display:"flex",gap:8,marginBottom:followUpResult||followUpError||followUpLoading?10:0}}>
                                <button className="btn-ghost" style={{flex:1,borderColor:"#7B5EA7",color:"#7B5EA7",padding:"9px",fontSize:"0.78rem"}} onClick={()=>followUpRef.current?.click()}>
                                  📷 {followUpImg?"RETAKE PHOTO":"UPLOAD PHOTO"}
                                </button>
                                {followUpImg&&(
                                  <button className="btn-main" style={{flex:1,padding:"9px",fontSize:"0.78rem",background:followUpLoading?"#3D2A6B":"#7B5EA7",borderColor:"#7B5EA7"}}
                                    onClick={()=>analyzeFollowUp(h)} disabled={followUpLoading}>
                                    {followUpLoading?"⏳ ANALYZING...":"🔬 ANALYZE IMPACT"}
                                  </button>
                                )}
                              </div>

                              {/* Analysis Result */}
                              {followUpError&&<div style={{background:"#2A0A0A",border:"1px solid #E05050",color:"#E05050",padding:"10px",fontSize:"0.74rem",borderRadius:4}}>{followUpError}</div>}
                              {followUpResult&&(()=>{
                                const r=followUpResult;
                                const trendClr = r.trend==="IMPROVING"?"#4CAF50":r.trend==="WORSENING"?"#E05050":"#E8650A";
                                const trendIcon = r.trend==="IMPROVING"?"📈":r.trend==="WORSENING"?"📉":"➡️";
                                const scoreClr = r.recoveryScore>=70?"#4CAF50":r.recoveryScore>=40?"#E8650A":"#E05050";
                                return(
                                  <div style={{background:"#0E0A1A",border:"2px solid #7B5EA7",borderRadius:4,overflow:"hidden"}}>
                                    {/* Header */}
                                    <div style={{background:"#7B5EA7",padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",letterSpacing:".15em",color:"#FFF"}}>🔬 IMPACT REPORT</div>
                                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.75rem",color:trendClr,background:"#1A0D2E",padding:"2px 8px",border:`1px solid ${trendClr}`}}>{trendIcon} {r.trend}</div>
                                    </div>
                                    <div style={{padding:"12px"}}>
                                      {/* Recovery score bar */}
                                      <div style={{marginBottom:12}}>
                                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                          <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".12em",color:"#B8A0D0"}}>RECOVERY SCORE</span>
                                          <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1rem",color:scoreClr}}>{r.recoveryScore}%</span>
                                        </div>
                                        <div style={{background:"#2E1A4A",height:10,borderRadius:5,overflow:"hidden"}}>
                                          <div style={{width:`${r.recoveryScore}%`,height:"100%",background:scoreClr,transition:"width 1s ease",borderRadius:5}}/>
                                        </div>
                                      </div>

                                      {/* Affected area comparison */}
                                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                                        <div style={{background:"#1A0D2E",padding:"8px",border:"1px solid #3D2A6B",borderRadius:4,textAlign:"center"}}>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",color:"#6B5590",letterSpacing:".1em",marginBottom:3}}>BEFORE</div>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",color:"#E05050"}}>{r.affectedAreaBefore||r.originalSeverity}</div>
                                          <div style={{fontSize:"0.6rem",color:"#6B5590"}}>affected</div>
                                        </div>
                                        <div style={{background:"#1A0D2E",padding:"8px",border:"1px solid #3D2A6B",borderRadius:4,textAlign:"center"}}>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",color:"#6B5590",letterSpacing:".1em",marginBottom:3}}>NOW</div>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",color:scoreClr}}>{r.affectedAreaNow||r.currentSeverity}</div>
                                          <div style={{fontSize:"0.6rem",color:"#6B5590"}}>affected</div>
                                        </div>
                                      </div>

                                      {/* Severity change */}
                                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12,background:"#1A0D2E",padding:"8px 10px",border:"1px solid #3D2A6B",borderRadius:4}}>
                                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",color:"#E05050"}}>{r.originalSeverity}</div>
                                        <div style={{flex:1,height:2,background:"linear-gradient(to right,#E05050,"+scoreClr+")"}}/>
                                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",color:scoreClr}}>{r.currentSeverity}</div>
                                      </div>

                                      {/* Warning */}
                                      {r.warningFlag&&<div style={{background:"#2A0A0A",border:"1px solid #E05050",color:"#E05050",padding:"8px 10px",fontSize:"0.72rem",borderRadius:4,marginBottom:10}}>⚠️ {r.warningFlag}</div>}

                                      {/* Findings */}
                                      {r.findings?.length>0&&(
                                        <div style={{marginBottom:10}}>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".12em",color:"#B8A0D0",marginBottom:6}}>KEY FINDINGS</div>
                                          {r.findings.map((f,i)=>(
                                            <div key={i} style={{display:"flex",gap:6,marginBottom:4,fontSize:"0.72rem",color:"#D4C0F0",lineHeight:1.4}}>
                                              <span style={{color:"#7B5EA7",flexShrink:0}}>▸</span><span>{f}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Next steps */}
                                      {r.nextSteps&&(
                                        <div style={{background:"#1A1100",border:"1px solid #E8650A",borderRadius:4,padding:"8px 10px"}}>
                                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".12em",color:"#E8650A",marginBottom:4}}>NEXT ACTION</div>
                                          <div style={{fontSize:"0.72rem",color:"#FFF0D0",lineHeight:1.5}}>{r.nextSteps}</div>
                                        </div>
                                      )}

                                      {/* Status update chip */}
                                      <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",color:"#6B5590"}}>STATUS AUTO-UPDATED →</div>
                                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.7rem",color:"#FFF",background:ST_COLOR[r.statusRecommendation]||"#6B5530",padding:"2px 10px"}}>{r.statusRecommendation}</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </Panel>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* ══ SIMULATE ══ */}
          {tab==="simulate"&&(
            <div className="fade-up">
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={{fontSize:"1.3rem"}}>🧪</span>
                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",letterSpacing:".15em",color:"#FFF0D0"}}>TREATMENT SIMULATION</div>
              </div>
              <div style={{fontSize:"0.76rem",color:"#6B5530",marginBottom:14}}>Compare chemical vs organic treatment — cost, yield &amp; risk.</div>

              <Panel accent="#E8650A" style={{marginBottom:14}}>
                <div style={{padding:"14px 14px 10px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {/* CROP DROPDOWN */}
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".18em",color:"#6B5530",marginBottom:5}}>CROP</div>
                    <select value={simCrop} onChange={e=>{setSimCrop(e.target.value);setSimDisease("");}}
                      style={{width:"100%",background:"#1A1100",border:"2px solid #E8650A",color:simCrop?"#FFF0D0":"#6B5530",fontFamily:"'Baloo 2',sans-serif",fontSize:".82rem",padding:"8px 10px",outline:"none",appearance:"none"}}>
                      <option value="">-- SELECT CROP --</option>
                      {CROPS.map(c=><option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </div>
                  {/* DISEASE TEXT INPUT */}
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".18em",color:"#6B5530",marginBottom:5}}>DISEASE <span style={{color:"#3A2A00",fontSize:"0.52rem"}}>(OR UPLOAD IMAGE ↓)</span></div>
                    <input value={simDisease} onChange={e=>setSimDisease(e.target.value)}
                      placeholder={simImg?"AUTO-DETECT FROM IMAGE":"TYPE DISEASE NAME"}
                      style={{width:"100%",background:"#1A1100",border:"2px solid #E8650A",color:"#FFF0D0",fontFamily:"'Baloo 2',sans-serif",fontSize:".78rem",padding:"8px 10px",outline:"none"}}/>
                  </div>
                  {/* AREA */}
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".18em",color:"#6B5530",marginBottom:5}}>FARM AREA (ACRES)</div>
                    <input value={simArea} onChange={e=>setSimArea(e.target.value)} placeholder="E.G. 2.5" type="number" min="0"
                      style={{width:"100%",background:"#1A1100",border:"2px solid #E8650A",color:"#FFF0D0",fontFamily:"'Baloo 2',sans-serif",fontSize:".82rem",padding:"8px 10px",outline:"none"}}/>
                  </div>
                  {/* PRIORITY */}
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".18em",color:"#6B5530",marginBottom:5}}>PRIORITY</div>
                    <select value={simPriority} onChange={e=>setSimPriority(e.target.value)}
                      style={{width:"100%",background:"#1A1100",border:"2px solid #E8650A",color:"#FFF0D0",fontFamily:"'Baloo 2',sans-serif",fontSize:".82rem",padding:"8px 10px",outline:"none",appearance:"none"}}>
                      {["MAX YIELD SAVED","LOW COST","ORGANIC PREFERRED","BALANCED"].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                {/* Image Upload Section */}
                <div style={{padding:"0 14px 10px"}}>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".18em",color:"#6B5530",marginBottom:6}}>📷 UPLOAD CROP IMAGE <span style={{color:"#3A2A00",fontSize:"0.5rem"}}>(OPTIONAL — AI WILL DETECT DISEASE)</span></div>
                  <input ref={simImgRef} type="file" accept="image/*" style={{display:"none"}}
                    onChange={e=>{
                      const f=e.target.files?.[0]; if(!f) return;
                      setSimImgMime(f.type||"image/jpeg");
                      const r=new FileReader();
                      r.onload=ev=>{ const d=ev.target.result; setSimImg(d.split(",")[1]); };
                      r.readAsDataURL(f);
                    }}/>
                  {simImg ? (
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <img src={`data:${simImgMime};base64,${simImg}`} alt="sim"
                        style={{width:60,height:60,objectFit:"cover",border:"2px solid #E8650A"}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:"0.7rem",color:"#7B9E4A",marginBottom:4}}>✅ Image uploaded{!simDisease.trim()&&" — disease will be auto-detected"}</div>
                        <button onClick={()=>{setSimImg(null);if(simImgRef.current)simImgRef.current.value="";}} 
                          style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"3px 10px",background:"transparent",border:"1px solid #FF2D55",color:"#FF2D55",cursor:"pointer",letterSpacing:".08em"}}>✕ REMOVE</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={()=>simImgRef.current?.click()}
                      style={{width:"100%",background:"#1A1100",border:"2px dashed #E8650A44",color:"#6B5530",fontFamily:"'Baloo 2',sans-serif",fontSize:".78rem",padding:"10px",cursor:"pointer",textAlign:"center"}}>
                      📷 TAP TO ADD PHOTO (optional)
                    </button>
                  )}
                </div>
                {/* Chip preview */}
                {simCrop&&(simDisease||simImg)&&(
                  <div style={{display:"flex",gap:6,padding:"0 14px 10px",flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"3px 10px",background:"#E8650A22",border:"1px solid #E8650A",color:"#E8650A",letterSpacing:".08em"}}>🌾 {simCrop.toUpperCase()}</span>
                    {simDisease&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"3px 10px",background:"#FF2D5522",border:"1px solid #FF2D55",color:"#FF2D55",letterSpacing:".08em"}}>🦠 {simDisease.toUpperCase()}</span>}
                    {simImg&&!simDisease&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"3px 10px",background:"#7B9E4A22",border:"1px solid #7B9E4A",color:"#7B9E4A",letterSpacing:".08em"}}>📷 AUTO-DETECT</span>}
                    {simArea&&<span style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",padding:"3px 10px",background:"#00D4CC22",border:"1px solid #00D4CC",color:"#00D4CC",letterSpacing:".08em"}}>📐 {simArea} ACRES</span>}
                  </div>
                )}
                <button className="btn-main" onClick={runSimulation} disabled={simLoading||!simCrop||(!simDisease.trim()&&!simImg)||!simArea.trim()}
                  style={{margin:"0 14px 14px",width:"calc(100% - 28px)"}}>
                  {simLoading?"⏳ ANALYSING…":"🧑‍🌾 RUN SIMULATION"}
                </button>
              </Panel>

              {simError&&<div style={{color:"#FF2D55",fontSize:"0.78rem",marginBottom:12,padding:"10px",border:"2px solid #FF2D55",background:"rgba(255,45,85,.08)"}}>{simError}</div>}

              {simResult&&(
                <div className="fade-up">
                  {/* Detected disease banner when image was used */}
                  {simResult.detectedDisease&&simImg&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",marginBottom:8,background:"#1A1100",border:"2px solid #7B9E4A"}}>
                      <span style={{fontSize:"0.9rem"}}>📷</span>
                      <div>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",letterSpacing:".1em",color:"#7B9E4A"}}>DISEASE DETECTED FROM IMAGE</div>
                        <div style={{fontSize:"0.78rem",color:"#FFF0D0",fontWeight:700}}>{simResult.detectedDisease}</div>
                      </div>
                    </div>
                  )}
                  {/* Recommendation Banner */}
                  <div style={{background:simResult.recommendation==="chemical"?"#E8650A":"#7B9E4A",padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:"1.2rem"}}>{simResult.recommendation==="chemical"?"⚗️":"🌿"}</span>
                    <div>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",color:"#0F0A00",letterSpacing:".1em"}}>RECOMMENDED: {simResult.recommendation?.toUpperCase()}</div>
                      <div style={{fontSize:"0.7rem",color:"#0F0A00",opacity:.85}}>{simResult.reasoning}</div>
                    </div>
                  </div>

                  {/* Side by side cards */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    {[
                      {label:"⚗️ CHEMICAL",d:simResult.chemical,accent:"#E8650A",extraKey:"sideEffect",extraLabel:"⚠ Side Effect"},
                      {label:"🌿 ORGANIC",d:simResult.organic,accent:"#7B9E4A",extraKey:"benefit",extraLabel:"✅ Bonus"}
                    ].map(({label,d,accent,extraKey,extraLabel})=>(
                      <Panel key={label} accent={accent} style={{padding:0}}>
                        <div style={{padding:"10px 10px 12px"}}>
                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.78rem",letterSpacing:".12em",color:accent,marginBottom:8}}>{label}</div>
                          {[
                            ["Remedy",d?.pesticide||d?.remedy],
                            ["Dosage",d?.dosage],
                            ["Spray",d?.sprayTiming],
                            ["Cost/acre","₹"+(d?.costPerAcre||0).toLocaleString("en-IN")],
                            ["Labor","₹"+(d?.laborCost||0).toLocaleString("en-IN")],
                            ["Total","₹"+(d?.totalCost||0).toLocaleString("en-IN")],
                            ["Yield saved",(d?.yieldSaved||0)+"%"],
                            ["ROI",(d?.roi||0)+"%"],
                            ["Weeks",(d?.weeks||"?")+" wks"],
                            ["Env Risk",d?.envRisk],
                          ].map(([k,v])=>(
                            <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:"0.7rem",padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
                              <span style={{color:"#6B5530"}}>{k}</span>
                              <span style={{color:"#FFF0D0",fontWeight:600,textAlign:"right",maxWidth:"60%"}}>{v}</span>
                            </div>
                          ))}
                          {d?.[extraKey]&&(
                            <div style={{marginTop:6,fontSize:"0.66rem",color:accent,lineHeight:1.4,padding:"4px 6px",background:accent+"18",borderLeft:"2px solid "+accent}}>
                              {extraLabel}: {d[extraKey]}
                            </div>
                          )}
                        </div>
                      </Panel>
                    ))}
                  </div>
                  {/* Yield Bar comparison */}
                  <Panel accent="#E8A020" style={{marginBottom:10}}>
                    <div style={{padding:"10px 14px"}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.68rem",letterSpacing:".15em",color:"#6B5530",marginBottom:8}}>YIELD SAVED COMPARISON</div>
                      {[["⚗️ Chemical",simResult.chemical?.yieldSaved,"#E8650A"],["🌿 Organic",simResult.organic?.yieldSaved,"#7B9E4A"]].map(([l,v,c])=>(
                        <div key={l} style={{marginBottom:6}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.66rem",color:"#6B5530",marginBottom:2}}><span>{l}</span><span style={{color:c,fontWeight:700}}>{v}%</span></div>
                          <div style={{height:8,background:"#1A1100",borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:(v||0)+"%",background:c,borderRadius:4,transition:"width .6s ease"}}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  {/* Net Profit */}
                  <Panel accent="#00D4CC" style={{marginBottom:10}}>
                    <div style={{padding:"10px 14px"}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.72rem",letterSpacing:".15em",color:"#6B5530",marginBottom:6}}>NET PROFIT FOR {simArea} ACRES</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:6}}>
                        {[["⚗️ Chemical",simResult.netProfitChemical,"#E8650A"],["🌿 Organic",simResult.netProfitOrganic,"#7B9E4A"]].map(([l,v,c])=>(
                          <div key={l} style={{textAlign:"center"}}>
                            <div style={{fontSize:"0.68rem",color:"#6B5530"}}>{l}</div>
                            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.3rem",color:c}}>₹{(Number(v||0)*Number(simArea||1)).toLocaleString("en-IN")}</div>
                          </div>
                        ))}
                      </div>
                      {simResult.marketPremiumOrganic&&(
                        <div style={{fontSize:"0.68rem",color:"#7B9E4A",textAlign:"center",padding:"4px 8px",background:"#7B9E4A18",borderRadius:2}}>
                          🌾 Organic mandi premium: +{simResult.marketPremiumOrganic}% (already included above)
                        </div>
                      )}
                    </div>
                  </Panel>

                  {/* Safety + Market notes */}
                  {simResult.safetyNote&&<div style={{fontSize:"0.74rem",color:"#E8A020",padding:"8px 12px",border:"1px solid rgba(232,160,32,.3)",background:"rgba(232,160,32,.06)",marginBottom:8}}>⚠️ {simResult.safetyNote}</div>}
                  {simResult.marketNote&&<div style={{fontSize:"0.74rem",color:"#00D4CC",padding:"8px 12px",border:"1px solid rgba(0,212,204,.3)",background:"rgba(0,212,204,.06)",marginBottom:10}}>📈 {simResult.marketNote}</div>}

                  {/* HOW WAS THIS CALCULATED */}
                  {simResult.howCalculated&&(
                    <Panel accent="#6B5530" style={{marginBottom:14}}>
                      <div style={{padding:"12px 14px"}}>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.72rem",letterSpacing:".15em",color:"#E8A020",marginBottom:10}}>🧮 YEH NUMBERS KAISE AAYE? (HOW IS THIS CALCULATED)</div>
                        {[
                          ["📦 Fasal ki kamat",simResult.howCalculated.cropValuePerAcre,"#FFF0D0"],
                          ["⚗️ Chemical calculation",simResult.howCalculated.chemicalStep,"#E8650A"],
                          ["🌿 Organic calculation",simResult.howCalculated.organicStep,"#7B9E4A"],
                          ["🌾 Yield bachta kya?",simResult.howCalculated.yieldNote,"#E8A020"],
                        ].map(([label,val,color])=>val&&(
                          <div key={label} style={{marginBottom:10,paddingBottom:10,borderBottom:"1px solid #2A1A00"}}>
                            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.58rem",letterSpacing:".12em",color:"#6B5530",marginBottom:3}}>{label}</div>
                            <div style={{fontSize:"0.75rem",color,lineHeight:1.6}}>{val}</div>
                          </div>
                        ))}
                        {simResult.howCalculated.winner&&(
                          <div style={{padding:"8px 12px",background:simResult.recommendation==="chemical"?"#E8650A22":"#7B9E4A22",border:"1.5px solid "+(simResult.recommendation==="chemical"?"#E8650A":"#7B9E4A"),borderRadius:2}}>
                            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",letterSpacing:".1em",color:"#6B5530",marginBottom:3}}>🏆 SEEDHA JAWAB</div>
                            <div style={{fontSize:"0.78rem",color:"#FFF0D0",fontWeight:600,lineHeight:1.5}}>{simResult.howCalculated.winner}</div>
                          </div>
                        )}
                      </div>
                    </Panel>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ GUIDE ══ */}
          {tab==="mystate"&&(()=>{
            const sd=STATE_AGI_DATA[state]||STATE_AGI_DATA["Maharashtra"];
            return(
              <div className="fade-up">
                {/* Title */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                  <span style={{fontSize:"1.4rem"}}>📍</span>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"1.1rem",letterSpacing:".15em",color:"#FFF0D0"}}>{state.toUpperCase()} AGRI INTELLIGENCE</div>
                </div>

                {/* Location Intel Panel */}
                <Panel accent="#00D4CC" style={{marginBottom:12}}>
                  <div style={{padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <Strip bg="#00D4CC" style={{fontSize:"0.6rem",margin:0}}>📍 LOCATION INTEL · {state.toUpperCase()}</Strip>
                      <button className="btn-ghost" onClick={()=>setShowStateExtra(x=>!x)} style={{fontSize:"0.6rem",padding:"3px 10px",borderColor:"#00D4CC",color:"#00D4CC"}}>{showStateExtra?"▲ LESS":"▼ MORE"}</button>
                    </div>
                    {/* Season / Soil / Rain */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
                      {[["SEASON",sd.season,"#E8650A"],["SOIL",sd.soil,"#7B9E4A"],["RAIN",sd.rain,"#00D4CC"]].map(([l,v,c])=>(
                        <div key={l} style={{background:"#120D02",border:"2px solid "+c+"44",padding:"8px 8px"}}>
                          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.52rem",letterSpacing:".12em",color:c,marginBottom:3}}>{l}</div>
                          <div style={{fontSize:"0.72rem",color:"#FFF0D0",fontWeight:600,lineHeight:1.3}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Disease risk tags */}
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                      {sd.diseases.map(d=>(
                        <span key={d} style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.65rem",padding:"3px 10px",border:"1.5px solid #E8A020",color:"#E8A020",letterSpacing:".08em"}}>{d}</span>
                      ))}
                    </div>
                    {/* Pest Alert */}
                    <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6,padding:"7px 10px",background:"#2A0A0A",borderLeft:"3px solid #FF2D55"}}>
                      <span style={{color:"#FF2D55",fontSize:"0.72rem",flexShrink:0}}>⚠</span>
                      <span style={{fontSize:"0.72rem",color:"#FF8099",lineHeight:1.5}}><b>PEST ALERT:</b> {sd.pestAlert}</span>
                    </div>
                    {/* Water */}
                    <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6,padding:"7px 10px",background:"#0A1A2A",borderLeft:"3px solid #00D4CC"}}>
                      <span style={{color:"#00D4CC",fontSize:"0.72rem",flexShrink:0}}>💧</span>
                      <span style={{fontSize:"0.72rem",color:"#80E8F0",lineHeight:1.5}}><b>WATER:</b> {sd.water}</span>
                    </div>
                    {/* Soil Care */}
                    <div style={{display:"flex",gap:8,alignItems:"flex-start",padding:"7px 10px",background:"#0A2A0A",borderLeft:"3px solid #7B9E4A"}}>
                      <span style={{color:"#7B9E4A",fontSize:"0.72rem",flexShrink:0}}>🌱</span>
                      <span style={{fontSize:"0.72rem",color:"#A8D080",lineHeight:1.5}}><b>SOIL CARE:</b> {sd.soilCare}</span>
                    </div>

                    {showStateExtra&&(
                      <div style={{marginTop:10,padding:"10px",background:"#120D02",border:"1px solid #2E2010"}}>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".12em",color:"#E8650A",marginBottom:6}}>💡 CROP TIP</div>
                        <div style={{fontSize:"0.72rem",color:"#D4B896",lineHeight:1.5,marginBottom:10}}>{sd.cropTip}</div>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.62rem",letterSpacing:".12em",color:"#E8A020",marginBottom:6}}>🌦 WEATHER HINT</div>
                        <div style={{fontSize:"0.72rem",color:"#D4B896",lineHeight:1.5}}>{sd.weatherHint}</div>
                      </div>
                    )}
                  </div>
                </Panel>

                {/* Major Crops */}
                <Panel accent="#7B9E4A" style={{marginBottom:12}}>
                  <div style={{padding:"12px 14px"}}>
                    <Strip bg="#7B9E4A" style={{marginBottom:10,fontSize:"0.6rem"}}>🌾 MAJOR CROPS</Strip>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {sd.crops.map(c=>(
                        <button key={c} onClick={()=>{setCrop(c);setTab("diagnose");}} style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.72rem",padding:"5px 12px",background:crop===c?"#7B9E4A":"#1A1100",color:crop===c?"#0F0A00":"#7B9E4A",border:"1.5px solid #7B9E4A",cursor:"pointer",letterSpacing:".08em"}}>{c}</button>
                      ))}
                    </div>
                    <div style={{marginTop:8,fontSize:"0.68rem",color:"#4A5530"}}>Tap a crop to select it, then Diagnose</div>
                  </div>
                </Panel>

                {/* Current season AI Rec  */}
                <Panel accent="#E8650A" style={{marginBottom:12}}>
                  <div style={{padding:"12px 14px"}}>
                    <Strip bg="#E8650A" style={{marginBottom:10,fontSize:"0.6rem"}}>📋 SEASONAL ADVISORY</Strip>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div style={{background:"#1A1100",border:"1px solid #E8650A44",padding:"10px"}}>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",color:"#E8650A",marginBottom:4}}>WATCH OUT</div>
                        {sd.diseases.slice(0,3).map((d,i)=>(
                          <div key={i} style={{fontSize:"0.68rem",color:"#D4B896",display:"flex",gap:5,marginBottom:3}}><span style={{color:"#E8650A"}}>▸</span>{d}</div>
                        ))}
                      </div>
                      <div style={{background:"#1A1100",border:"1px solid #7B9E4A44",padding:"10px"}}>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.6rem",color:"#7B9E4A",marginBottom:4}}>SOIL HEALTH</div>
                        <div style={{fontSize:"0.68rem",color:"#D4B896",lineHeight:1.5}}>{sd.soilCare}</div>
                      </div>
                    </div>
                  </div>
                </Panel>

                {/* Govt Schemes */}
                <Panel accent="#7B5EA7" style={{marginBottom:12}}>
                  <div style={{padding:"12px 14px"}}>
                    <Strip bg="#7B5EA7" style={{marginBottom:10,fontSize:"0.6rem"}}>🏛 GOVT SCHEMES</Strip>
                    {sd.schemes.map((sc,i)=>(
                      <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:i<sd.schemes.length-1?"1px solid #2E1A4A":"none"}}>
                        <span style={{color:"#7B5EA7",fontSize:"0.75rem"}}>▶</span>
                        <span style={{fontSize:"0.76rem",color:"#D4C0F0"}}>{sc}</span>
                      </div>
                    ))}
                  </div>
                </Panel>

                {/* University + Helpline */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                  <Panel accent="#4A5530">
                    <div style={{padding:"12px 12px"}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.55rem",letterSpacing:".12em",color:"#7B9E4A",marginBottom:5}}>🎓 UNIVERSITY</div>
                      <div style={{fontSize:"0.74rem",color:"#FFF0D0",fontWeight:600}}>{sd.university}</div>
                    </div>
                  </Panel>
                  <Panel accent="#FF2D55">
                    <div style={{padding:"12px 12px"}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.55rem",letterSpacing:".12em",color:"#FF2D55",marginBottom:5}}>📞 HELPLINE</div>
                      <div style={{fontSize:"0.74rem",color:"#FFF0D0",fontWeight:600}}>{sd.helpline}</div>
                    </div>
                  </Panel>
                </div>

                {/* Quick diagnose CTA */}
                <button className="btn-main" onClick={()=>setTab("diagnose")} style={{marginBottom:8}}>
                  📷 DIAGNOSE {crop.toUpperCase()} NOW
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* KRISHIMITRA CHATBOT */}
      <div style={{position:"fixed",bottom:72,right:16,zIndex:200}}>
        {/* Chat Panel */}
        {chatOpen&&(
          <div style={{width:310,height:420,background:"#120D02",border:"2px solid #00D4CC",display:"flex",flexDirection:"column",marginBottom:10,boxShadow:"0 0 24px rgba(0,212,204,0.25)"}}>
            {/* Header */}
            <div style={{background:"#00D4CC",padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:"0.9rem",color:"#0F0A00",letterSpacing:".1em"}}>🌾 KRISHIMITRA AI</div>
                <div style={{fontSize:"0.6rem",color:"#0F0A00",opacity:.7}}>{state} · {crop}</div>
              </div>
              <button onClick={()=>setChatOpen(false)} style={{background:"transparent",border:"none",color:"#0F0A00",fontSize:"1.1rem",cursor:"pointer",padding:0,lineHeight:1}}>✕</button>
            </div>
            {/* Messages */}
            <div style={{flex:1,overflowY:"auto",padding:"10px 10px 0",display:"flex",flexDirection:"column",gap:8}}>
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%"}}>
                  <div style={{background:m.role==="user"?"#E8650A":"#1A1100",color:m.role==="user"?"#0F0A00":"#FFF0D0",padding:"7px 10px",fontSize:"0.76rem",lineHeight:1.6,whiteSpace:"pre-wrap",border:m.role==="assistant"?"1px solid #2E2010":"none"}}>
                    {m.content}
                  </div>
                  {m.role==="assistant"&&(
                    <button onClick={()=>speakText(m.content,i)}
                      style={{background:"transparent",border:"none",cursor:"pointer",padding:"2px 4px",fontSize:"0.9rem",opacity:.7}}>
                      {speakingIdx===i?"⏸":"🔊"}
                    </button>
                  )}
                </div>
              ))}
              {chatBusy&&<div style={{alignSelf:"flex-start",color:"#6B5530",fontSize:"0.72rem",fontFamily:"'Bebas Neue',cursive",letterSpacing:".1em"}}>THINKING…</div>}
              <div ref={chatEndRef}/>
            </div>
            {/* Input */}
            <div style={{display:"flex",borderTop:"2px solid #1E1408",flexShrink:0}}>
              <button onClick={startListening}
                style={{background:isListening?"#FF2D55":"#1A1100",border:"none",borderRight:"2px solid #1E1408",color:isListening?"#FFF0D0":"#6B5530",padding:"0 12px",cursor:"pointer",fontSize:"1rem",flexShrink:0,animation:isListening?"pulse 1s infinite":"none"}}>
                🎤
              </button>
              <input
                value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&sendChat()}
                placeholder={isListening?"🎙 सुन रहा हूँ...‬":"\u0905\u092a\u0928\u093e \u0938\u0935\u093e\u0932 \u0932\u093f\u0916\u0947\u0902\u2026"}
                style={{flex:1,background:"#0F0A00",border:"none",color:"#FFF0D0",padding:"10px 10px",fontSize:"0.78rem",fontFamily:"'Baloo 2',sans-serif",outline:"none"}}
              />
              <button onClick={sendChat} disabled={chatBusy} style={{background:"#00D4CC",border:"none",color:"#0F0A00",padding:"0 14px",fontFamily:"'Bebas Neue',cursive",fontSize:"0.85rem",cursor:"pointer",flexShrink:0}}>SEND</button>
            </div>
          </div>
        )}
        {/* FAB Button */}
        <button onClick={()=>setChatOpen(o=>!o)} style={{width:54,height:54,borderRadius:"50%",background:chatOpen?"#FF2D55":"#00D4CC",border:"3px solid #0F0A00",boxShadow:"0 4px 16px rgba(0,212,204,0.4)",cursor:"pointer",fontSize:"1.5rem",display:"flex",alignItems:"center",justifyContent:"center",marginLeft:"auto"}}>
          {chatOpen?"✕":"🌾"}
        </button>
      </div>

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,background:"#0F0A00",borderTop:"3px solid #E8650A",display:"flex",justifyContent:"center"}}>
        <div style={{maxWidth:480,width:"100%",display:"flex"}}>
          {[["diagnose","DIAGNOSE"],["outbreak","OUTBREAK"],["history","HISTORY"],["simulate","🧪"],["mystate","MY STATE"]].map(([t,l])=>(
            <button key={t} className={"nav-btn "+(tab===t?"active":"")} onClick={()=>setTab(t)}
              style={{color:t==="outbreak"&&outbreakAlerts.length&&tab!==t?"#FF2D55":""}}>
              {l}{t==="outbreak"&&outbreakAlerts.length?" 🚨":""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}