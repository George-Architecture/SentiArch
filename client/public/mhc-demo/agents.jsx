/* global React */
// 25 agents — order matches the pixel sprite-sheet (5 cols × 5 rows, row-major)
// Each entry: sprite cell + base profile + original "home zone" + their actual experience summary

const AGENTS = [
  // Row 1
  { id: "pauline",    img: "assets/agents/pauline.png",    name: "Pauline Cheung",  role: "Receptionist",            tags: ["staff", "front-of-house"], asi: 3,  asiLevel: "normal",  mbti: "ENFJ", age: 34, home: "reception",
    summary: "I'm at the reception desk, wrapping up the morning log. The room hums with low conversation; the greenery softens the noise. My body is heavy from the long shift, but the faces are familiar." },
  { id: "dr_shum",    img: "assets/agents/dr_shum.png",    name: "Dr Shum Ka Hei",  role: "Clinical Psychologist",   tags: ["staff", "therapist"],      asi: 4,  asiLevel: "normal",  mbti: "INFJ", age: 46, home: "staff_lounge",
    summary: "I'm in the staff lounge, a quiet reset between clients. Dim light is grounding, but my eyes feel the strain. Janet and Adrian are here too — a shared pause without speech." },
  { id: "dr_bernice", img: "assets/agents/dr_bernice.png", name: "Dr Bernice Lee",  role: "Therapist (Locum)",       tags: ["staff", "therapist"],      asi: 6,  asiLevel: "normal",  mbti: "INFJ", age: 38, home: "therapy_2",
    summary: "Reviewing Bonnie's file before her session. The greenery outside is a quiet relief. My body's heavy, but the room's soft hum holds my focus." },
  { id: "dr_olivia",  img: "assets/agents/dr_olivia.png",  name: "Dr Olivia Wong",  role: "Clinical Psychologist",   tags: ["staff", "therapist"],      asi: 4,  asiLevel: "normal",  mbti: "ISFJ", age: 39, home: "therapy_3",
    summary: "In my therapy room. Greenery outside catches my eye — a small restorative anchor. Heavy day, but the familiar space gathers my focus before Bonnie arrives." },
  { id: "sky_lam",    img: "assets/agents/sky_lam.png",    name: "Sky Lam",         role: "Art Therapist",           tags: ["staff", "therapist"],      asi: 5,  asiLevel: "normal",  mbti: "INFP", age: 42, home: "art_therapy",
    summary: "Joanne is settling in across from me. The warm air feels right for grief work today. Fatigued but present — the quiet holds us both." },

  // Row 2
  { id: "sister_anna",img: "assets/agents/sister_anna.png",name: "Sister Anna Lai", role: "Group Facilitator",       tags: ["staff", "facilitator"],    asi: 3,  asiLevel: "normal",  mbti: "ENFP", age: 51, home: "group_therapy",
    summary: "Tuesday morning circle in rhythm. Soft green outside the window between turns of conversation. I feel the familiar weight of guiding this space." },
  { id: "janet",      img: "assets/agents/janet.png",      name: "Janet Wu",        role: "Clinic Coordinator",      tags: ["staff", "admin"],          asi: 3,  asiLevel: "normal",  mbti: "ESTJ", age: 44, home: "staff_lounge",
    summary: "In the staff lounge between schedule rounds. Dim, no windows — my eyes are tired. I'm running the next appointments through my head, ignoring the warmth in my shoulders." },
  { id: "dr_adrian",  img: "assets/agents/dr_adrian.png",  name: "Dr Adrian Pang",  role: "Clinical Psychologist",   tags: ["staff", "therapist"],      asi: 5,  asiLevel: "normal",  mbti: "INFP", age: 33, home: "staff_lounge",
    summary: "Catching a breather with Ka Hei and Janet. The warm air is heavy; greenery at the edge of my sight is a small anchor. Grateful for the pause." },
  { id: "mrs_tang",   img: "assets/agents/mrs_tang.png",   name: "Mrs Tang Mei Yu", role: "Client · Health Anxiety", tags: ["client", "health-anxiety"], asi: 58, asiLevel: "severe",  mbti: "ISTJ", age: 58, home: "tea_pause",
    summary: "Sitting in the tea area, cup in hand, trying to let the greenery settle my nerves after the session. The door feels far. My pulse is still a bit too quick." },
  { id: "andrew",     img: "assets/agents/andrew.png",     name: "Andrew Lo",       role: "Companion · Spouse",      tags: ["companion"],                asi: 4,  asiLevel: "normal",  mbti: "ESFJ", age: 35, home: "reception",
    summary: "Sitting with Hayley in the waiting area, trying not to let my fatigue show. The room's chatter presses in, but the greenery is a place for the eyes to rest." },

  // Row 3
  { id: "kevin",      img: "assets/agents/kevin.png",      name: "Kevin Lau",       role: "Client · Burnout",        tags: ["client", "burnout"],        asi: 31, asiLevel: "moderate", mbti: "ENTJ", age: 41, home: "entrance",
    summary: "At the main entrance, ready to leave. Dim light feels grating after that hour. Heavy fatigue; I just want to get back to the office." },
  { id: "wai_lung",   img: "assets/agents/wai_lung.png",   name: "Wai Lung Chan",   role: "Client · Social Anxiety", tags: ["client", "social-anxiety"], asi: 61, asiLevel: "severe",  mbti: "INTP", age: 22, home: "quiet_refuge_1",
    summary: "Alone in the quiet refuge, near the window. Dim light and calm air settle my nerves, but I keep glancing at the door — Sister Anna will call me soon." },
  { id: "hayley",     img: "assets/agents/hayley.png",     name: "Hayley Lo",       role: "Client · GAD (first-time)", tags: ["client", "gad"],          asi: 46, asiLevel: "moderate", mbti: "INFJ", age: 28, home: "reception",
    summary: "Andrew is beside me but my stomach is tight. The hum and dim light make the room feel heavy. I keep glancing at the window, wishing I could see out more clearly." },
  { id: "bonnie",     img: "assets/agents/bonnie.png",     name: "Bonnie Fung",     role: "Client · Social Anxiety", tags: ["client", "social-anxiety"], asi: 54, asiLevel: "severe",  mbti: "INFJ", age: 26, home: "reception",
    summary: "Trying to steady my breathing. The shuffle of people feels like a weight. I keep glancing at the window for visual escape — every small noise feels louder." },
  { id: "marcus",     img: "assets/agents/marcus.png",     name: "Marcus Yip",      role: "Client · Panic Disorder", tags: ["client", "panic"],          asi: 65, asiLevel: "severe",  mbti: "INFP", age: 31, home: "reception",
    summary: "Chest is tight knowing Dr Wong isn't here yet. The greenery is calming, but there's no exit in view. The wait stretches." },

  // Row 4
  { id: "joanne",     img: "assets/agents/joanne.png",     name: "Joanne Tse",      role: "Client · Grief + Panic",  tags: ["client", "grief", "panic"], asi: 52, asiLevel: "severe",  mbti: "ISFP", age: 37, home: "art_therapy",
    summary: "Sitting across from Sky in soft dimness, hands on my knees. Carrying grief all week — every small sound from the corridor feels louder than it should." },
  { id: "pearl",      img: "assets/agents/pearl.png",      name: "Pearl Ho",        role: "Client · GAD (severe)",   tags: ["client", "gad"],            asi: 60, asiLevel: "severe",  mbti: "ISFJ", age: 44, home: "tea_pause",
    summary: "Tea area after the circle. Karen is here; we're decompressing. The greenery near the window slows my breath — but I can still feel the session in my chest." },
  { id: "wilson",     img: "assets/agents/wilson.png",     name: "Wilson Tam",      role: "Client · Health Anxiety", tags: ["client", "health-anxiety"], asi: 49, asiLevel: "moderate", mbti: "ISTJ", age: 49, home: "group_therapy",
    summary: "In the circle, counting my heartbeats in silence. The round seating means everyone can see me; I keep my eyes on the floor pattern." },
  { id: "daniel",     img: "assets/agents/daniel.png",     name: "Daniel Mok",      role: "Client · Mild PTSD",      tags: ["client", "ptsd"],           asi: 55, asiLevel: "severe",  mbti: "ISTP", age: 38, home: "group_therapy",
    summary: "Back-to-the-wall seat by request. I can track all the exits from here. The voices in the circle are steady, but my shoulders won't fully drop." },
  { id: "iris",       img: "assets/agents/iris.png",       name: "Iris Cheng",      role: "Client · Preventive",     tags: ["client", "wellness"],       asi: 8,  asiLevel: "normal",  mbti: "ENFP", age: 29, home: "group_therapy",
    summary: "In the circle as a wellness participant. The greenery and round seating feel intentional — I'm here to learn the language of the others' anxieties." },

  // Row 5
  { id: "cherry",     img: "assets/agents/cherry.png",     name: "Cherry Ng",       role: "Client · Mild Depression",tags: ["client", "depression"],     asi: 22, asiLevel: "mild",     mbti: "INFP", age: 33, home: "group_therapy",
    summary: "Quiet today. The circle's warmth reaches me in small pulses. I listen more than I speak; the window's green is a soft horizon." },
  { id: "mr_patrick", img: "assets/agents/mr_patrick.png", name: "Mr Patrick Cheng",role: "Client · GAD (retired)",  tags: ["client", "gad"],            asi: 42, asiLevel: "moderate", mbti: "ISTJ", age: 55, home: "group_therapy",
    summary: "Recently retired. The morning circle is a structure I can hold onto. My posture is upright; my mind drifts to what comes after the session." },
  { id: "vanessa",    img: "assets/agents/vanessa.png",    name: "Vanessa Yeung",   role: "Client · Social Anxiety", tags: ["client", "social-anxiety"], asi: 51, asiLevel: "severe",   mbti: "ISFJ", age: 31, home: "quiet_refuge_2",
    summary: "Tucked into the second quiet refuge before the circle. The small space contains me. I'm rehearsing what I might say, but mostly I'm just breathing." },
  { id: "karen",      img: "assets/agents/karen.png",      name: "Karen Sit",       role: "Client · Preventive",     tags: ["client", "wellness"],       asi: 11, asiLevel: "normal",   mbti: "ESFJ", age: 36, home: "tea_pause",
    summary: "At the tea area with Pearl. Open posture, warm cup. I check in here weekly — the greenery and tea routine are the medicine." },
  { id: "tomas",      img: "assets/agents/tomas.png",      name: "Tomás Reyes",     role: "Client · Burnout",        tags: ["client", "burnout"],        asi: 28, asiLevel: "moderate", mbti: "ENTP", age: 34, home: "courtyard",
    summary: "Stepped into the courtyard for air between sessions. The stone underfoot, the plants, the open sky overhead — three minutes to reset." },
];

// Each agent now ships its own transparent PNG. Sprite is just an <img>-style div.
function spriteStyle(index, size = 96) {
  const agent = AGENTS[index];
  if (!agent) return { width: size + "px", height: size + "px" };
  return {
    backgroundImage: `url(${agent.img})`,
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center bottom",
    width: size + "px",
    height: size + "px",
    imageRendering: "pixelated",
  };
}

window.AGENTS = AGENTS;
window.spriteStyle = spriteStyle;
