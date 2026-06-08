/* AUTO-GENERATED from assets/rpgarchitecture_agents.json (the main app's
   exported mental-health-centre scenario). 25 real SentiArch engine
   personas (AgentData: ASI-3 score+level+modifiers, MBTI, metabolic
   rate, clo, vision/hearing/mobility) keyed by the demo's agent id.
   Regenerate: node _gen_personas.mjs   —  DO NOT hand-edit. */
window.MHC_PERSONAS = {
 "mrs_tang": {
  "agent": {
   "id": "anx_health_01",
   "age": 58,
   "gender": "female",
   "mbti": "ISTJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "severe_impairment",
   "metabolic_rate": 0.85,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 58,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (health anxiety)",
   "name": "Mrs Tang Mei Yu",
   "purpose_at_centre": "Returning health-anxiety client of Dr Shum at the Centre",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_clinician"
    },
    {
     "with": "staff_recep_01",
     "type": "checks_in_with"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the tea area with a cup in my hands, trying to let the calm of the greenery settle my nerves after the session. Pearl and Karen are nearby, their voices a low hum that I can't quite tune out, and I keep glancing at the window across the room—it's a relief to have that view, even if the door feels far from where I'm seated. Dr Shum isn't here, but I'm not waiting for her now; I'm just catching my breath before I leave, though my pulse still feels a bit too quick.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "asking the desk if her results/file are ready, seeking reassurance",
     "t_min": 20,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "in the consult, listing her physical symptoms one by one",
     "t_min": 40,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "stepping out after the session, trying to slow her breathing",
     "t_min": 120,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "a short tea before leaving; still checks her pulse but calmer",
     "t_min": 170,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "andrew": {
  "agent": {
   "id": "comp_spouse_01",
   "age": 35,
   "gender": "male",
   "mbti": "ESFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.15,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 4,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "companion (spouse, supporting Hayley)",
   "name": "Andrew Lo",
   "purpose_at_centre": "Spouse of Hayley; I accompany her to therapy appointments at the Centre",
   "relationships": [
    {
     "with": "anx_gad_01",
     "type": "is_spouse_of"
    },
    {
     "with": "staff_ther_01",
     "type": "is_clinician_of_spouse"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting here with Hayley in the waiting area, trying to keep my own fatigue from showing while I watch her. The room is dim and the low chatter from the other clients feels like it's pressing in, but the greenery outside the window gives my eyes a place to rest. I keep glancing at the reception desk, hoping Dr Shum will call us soon so Hayley doesn't have to sit here getting more anxious.",
   "waypoints": []
  }
 },
 "kevin": {
  "agent": {
   "id": "cli_burn_01",
   "age": 41,
   "gender": "male",
   "mbti": "ENTJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "mild_impairment",
   "metabolic_rate": 1,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 31,
    "asi_level": "moderate",
    "modifiers": {
     "noise_sensitivity": 1.4,
     "thermal_comfort_range": 1.6,
     "personal_space_radius": 1.09,
     "enclosure_sensitivity": 1.5,
     "exit_proximity_need": 1.5
    }
   },
   "role": "client (burnout)",
   "name": "Kevin Lau",
   "purpose_at_centre": "Client of Dr Shum for ongoing burnout treatment",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_clinician"
    },
    {
     "with": "staff_recep_01",
     "type": "checks_in_with"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm at the main entrance, ready to leave—the session with Dr Shum is done, and I just want to get back to the office. The dim lighting and low hum of noise feel grating after that hour, and the warmth is noticeable even with the greenery nearby. I'm scanning the room for the door, eager to step out and shake off this heavy fatigue.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "tells the desk he's \"just checking in\", minimal eye contact",
     "t_min": 15,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "session; talks workload more than himself",
     "t_min": 35,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "brief pause in the courtyard, phone still in hand",
     "t_min": 110,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "leaves immediately, no tea, heading back to the office",
     "t_min": 170,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "pauline": {
  "agent": {
   "id": "staff_recep_01",
   "age": 34,
   "gender": "female",
   "mbti": "ENFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.2,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 3,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "receptionist",
   "name": "Pauline Cheung",
   "purpose_at_centre": "Receptionist; I run front-of-house at the Centre",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_02",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_03",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_04",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_art_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_group_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm at the reception desk, wrapping up the morning log while the waiting area hums with low conversation. Andrew is here with Hayley, and Bonnie and Marcus are settled in their seats—I can feel the quiet tension in the room, but the lush greenery outside the window softens the edge of the noise. My body is heavy from the long shift, but I know this space and these faces; I'm just finishing up before the next wave.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "stepping to the entrance to greet an arriving client",
     "t_min": 30,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "back at the desk, phones and check-ins",
     "t_min": 70,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "a short break away from the desk",
     "t_min": 120,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "wrapping up, end-of-day logging",
     "t_min": 165,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "wai_lung": {
  "agent": {
   "id": "anx_soc_01",
   "age": 22,
   "gender": "male",
   "mbti": "INTP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 61,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (social anxiety)",
   "name": "Wai Lung Chan",
   "purpose_at_centre": "Member of Sister Anna's anxiety circle; usually I do 1:1 work",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm alone in this quiet refuge, sitting near the window where the greenery catches my eye. The dim light and calm air help settle my nerves, but I keep glancing at the door, knowing Sister Anna will call me soon. My body feels heavy from the long wait, and I'm bracing myself for the group session ahead.",
   "waypoints": []
  }
 },
 "dr_shum": {
  "agent": {
   "id": "staff_ther_01",
   "age": 46,
   "gender": "male",
   "mbti": "INFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "mild_impairment",
   "metabolic_rate": 1.05,
   "clothing_insulation": 0.7,
   "anxiety": {
    "asi_score": 4,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "therapist",
   "name": "Dr Shum Ka Hei",
   "purpose_at_centre": "Clinical psychologist at the Centre; I run individual therapy in Therapy Room 1",
   "relationships": [
    {
     "with": "anx_gad_01",
     "type": "is_client_of"
    },
    {
     "with": "anx_health_01",
     "type": "is_client_of"
    },
    {
     "with": "cli_burn_01",
     "type": "is_client_of"
    },
    {
     "with": "cli_well_02",
     "type": "is_client_of"
    },
    {
     "with": "staff_recep_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_02",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_03",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_04",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm in the staff lounge, taking a quiet reset between clients. The dim light and low hum of conversation feel grounding after back-to-back sessions, but the warmth and the slight strain in my eyes from the low light remind me I've been at this for a while. Janet and Adrian are here too, but we're each in our own space—no need to talk, just a shared pause.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "quick coffee, glancing at the day's schedule",
     "t_min": 10,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "mid-session with a client, courtyard-facing window",
     "t_min": 30,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "brief check-in about a referral",
     "t_min": 100,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "10-min reset before the next client, steady",
     "t_min": 150,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "hayley": {
  "agent": {
   "id": "anx_gad_01",
   "age": 28,
   "gender": "female",
   "mbti": "INFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.95,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 46,
    "asi_level": "moderate",
    "modifiers": {
     "noise_sensitivity": 1.4,
     "thermal_comfort_range": 1.6,
     "personal_space_radius": 1.09,
     "enclosure_sensitivity": 1.5,
     "exit_proximity_need": 1.5
    }
   },
   "role": "client (first-time, GAD)",
   "name": "Hayley Lo",
   "purpose_at_centre": "First-time client referred for generalised anxiety; intake series with Dr Shum",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_clinician"
    },
    {
     "with": "comp_spouse_01",
     "type": "is_spouse_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting here in the waiting area with Andrew beside me, but my stomach is tight. The low hum of conversation and the dim light make the room feel heavy, and I keep glancing at the window across the room, wishing I could see out more clearly. I know Dr Shum will call me soon, but the wait stretches out, and my mind keeps circling back to why I'm here.",
   "waypoints": []
  }
 },
 "dr_bernice": {
  "agent": {
   "id": "staff_ther_03",
   "age": 38,
   "gender": "female",
   "mbti": "INFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.1,
   "clothing_insulation": 0.65,
   "anxiety": {
    "asi_score": 6,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "therapist (locum)",
   "name": "Dr Bernice Lee",
   "purpose_at_centre": "Locum therapist at the Centre; I cover for regular clinicians when they are away",
   "relationships": [
    {
     "with": "anx_soc_02",
     "type": "is_locum_client"
    },
    {
     "with": "staff_ther_02",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm in Therapy Room2, reviewing Bonnie's file before her session. The greenery outside the window catches my eye, offering a brief moment of visual relief, but my body feels heavy from the long morning. I'm mentally preparing for the session, aware that the room's quiet hum and soft light are helping me stay focused despite my fatigue.",
   "waypoints": []
  }
 },
 "bonnie": {
  "agent": {
   "id": "anx_soc_02",
   "age": 26,
   "gender": "female",
   "mbti": "INFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.95,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 54,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (social anxiety)",
   "name": "Bonnie Fung",
   "purpose_at_centre": "Regular client of Dr Wong for social anxiety; weekly Tuesday 1:1 slot",
   "relationships": [
    {
     "with": "staff_ther_02",
     "type": "is_clinician"
    },
    {
     "with": "staff_ther_03",
     "type": "is_locum_clinician"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the waiting area, trying to steady my breathing. The low hum of conversation and the shuffle of people around me feels like a weight pressing in, and I keep glancing at the window at the far end for a visual escape. Dr Wong isn't here yet, and the anticipation of being called makes every small noise feel louder.",
   "waypoints": []
  }
 },
 "dr_olivia": {
  "agent": {
   "id": "staff_ther_02",
   "age": 39,
   "gender": "female",
   "mbti": "ISFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.1,
   "clothing_insulation": 0.65,
   "anxiety": {
    "asi_score": 4,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "therapist",
   "name": "Dr Olivia Wong",
   "purpose_at_centre": "Clinical psychologist at the Centre; I run individual therapy in Therapy Room 3",
   "relationships": [
    {
     "with": "anx_pan_01",
     "type": "is_client_of"
    },
    {
     "with": "anx_soc_02",
     "type": "is_client_of"
    },
    {
     "with": "staff_ther_03",
     "type": "is_locum_for_my_clients"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_04",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm in my therapy room, the dim light and soft hum from the corridor settling around me. The greenery outside the window catches my eye, a small restorative anchor as I mentally prepare for my next client, Bonnie, who will be here soon. My body feels heavy from the long day, but the familiar space and the quiet moment help me gather my focus.",
   "waypoints": []
  }
 },
 "marcus": {
  "agent": {
   "id": "anx_pan_01",
   "age": 31,
   "gender": "male",
   "mbti": "INFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.85,
   "clothing_insulation": 0.5,
   "anxiety": {
    "asi_score": 65,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (returning, panic disorder)",
   "name": "Marcus Yip",
   "purpose_at_centre": "Returning client of Dr Olivia Wong; I see her for ongoing panic disorder treatment",
   "relationships": [
    {
     "with": "staff_ther_02",
     "type": "is_clinician"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the waiting area, trying to steady my breathing. The dim light and the low hum of conversation feel heavy today, and even though the greenery outside the window is calming, my chest is tight knowing Dr Wong isn't here yet. I keep glancing at the door, but there's no exit in view, and the wait stretches ahead of me.",
   "waypoints": []
  }
 },
 "sky_lam": {
  "agent": {
   "id": "staff_art_01",
   "age": 42,
   "gender": "female",
   "mbti": "INFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.1,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 5,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "art_therapist",
   "name": "Sky Lam",
   "purpose_at_centre": "Art therapist at the Centre; I run expressive-arts sessions in Therapy Room 4",
   "relationships": [
    {
     "with": "anx_pan_02",
     "type": "is_client_of"
    },
    {
     "with": "comp_daughter_01",
     "type": "is_client_of"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_recep_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "Joanne is here, settling into her chair across from me. The dim light and warm air feel right for our session, helping soften the edges of her grief work. My body is heavy with fatigue, but I'm present, letting the quiet space hold us both.",
   "waypoints": []
  }
 },
 "joanne": {
  "agent": {
   "id": "anx_pan_02",
   "age": 37,
   "gender": "female",
   "mbti": "ISFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.9,
   "clothing_insulation": 0.5,
   "anxiety": {
    "asi_score": 52,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (returning, mild panic, processing grief)",
   "name": "Joanne Tse",
   "purpose_at_centre": "Returning client of Sky Lam; weekly expressive-arts sessions for mild panic and grief processing",
   "relationships": [
    {
     "with": "staff_art_01",
     "type": "is_clinician"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting across from Sky in the soft dimness of the therapy room, my hands resting on my knees as I try to settle into the session. The warm air and the glimpse of leaves outside the window help a little, but my body feels heavy from carrying this grief all week, and every small sound from the corridor feels louder than it should. I keep my eyes on the circle of paper and pastels between us, not on the door behind me, trying to let the quiet routine of this space hold me.",
   "waypoints": []
  }
 },
 "sister_anna": {
  "agent": {
   "id": "staff_group_01",
   "age": 51,
   "gender": "female",
   "mbti": "ENFP",
   "mobility": "walker",
   "hearing": "impaired",
   "vision": "severe_impairment",
   "metabolic_rate": 1.3,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 3,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "group_facilitator",
   "name": "Sister Anna Lai",
   "purpose_at_centre": "Group facilitator at the Centre; I run the Tuesday morning anxiety circle",
   "relationships": [
    {
     "with": "anx_gad_02",
     "type": "is_circle_member"
    },
    {
     "with": "anx_health_02",
     "type": "is_circle_member"
    },
    {
     "with": "cli_ptsd_01",
     "type": "is_circle_member"
    },
    {
     "with": "cli_well_01",
     "type": "is_circle_member"
    },
    {
     "with": "cli_dep_01",
     "type": "is_circle_member"
    },
    {
     "with": "anx_gad_03",
     "type": "is_circle_member"
    },
    {
     "with": "anx_soc_03",
     "type": "is_circle_member"
    },
    {
     "with": "anx_soc_01",
     "type": "is_circle_member"
    },
    {
     "with": "staff_recep_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the circle with Daniel, Cherry, Patrick, and Vanessa, the Tuesday morning group settling into its rhythm. The soft green outside the window catches my eye between turns of conversation, a small anchor of calm. I feel the familiar weight of guiding this space—attuned to each person's quiet tells, the room's gentle hum holding us together.",
   "waypoints": []
  }
 },
 "pearl": {
  "agent": {
   "id": "anx_gad_02",
   "age": 44,
   "gender": "female",
   "mbti": "ISFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.85,
   "clothing_insulation": 0.7,
   "anxiety": {
    "asi_score": 69,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (GAD, severe)",
   "name": "Pearl Ho",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the Tea/Pause Area with Mrs Tang, Karen, and Tomás, the dim light and the greenery outside the window helping me settle after the courtyard. My body feels heavy from the long morning, and I keep glancing at the door across the room, wanting to leave soon, but I'm also relieved the circle is over. The low hum of conversation around me feels a bit much right now, but I'm just sipping tea and letting the moment pass.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "tense at the doorway waiting to enter, last one in",
     "t_min": 25,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "chose the seat nearest the door deliberately, watching the clock",
     "t_min": 35,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "after the circle, in the courtyard, replaying what she said",
     "t_min": 140,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "a little tea then leaves, relieved it's over",
     "t_min": 170,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "wilson": {
  "agent": {
   "id": "anx_health_02",
   "age": 49,
   "gender": "male",
   "mbti": "ISTJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.95,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 51,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (health anxiety)",
   "name": "Wilson Tam",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the courtyard, trying to focus on the breathing exercise Sister Anna taught us, but the greenery feels too dense, almost suffocating, and the noise from the street makes it hard to settle my mind. My body is heavy from the morning's anxiety, and I keep glancing at the door across the space, wishing I could step out for air, but I know I need to stay for the circle.",
   "waypoints": []
  }
 },
 "daniel": {
  "agent": {
   "id": "cli_ptsd_01",
   "age": 38,
   "gender": "male",
   "mbti": "ISTP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.05,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 56,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (mild PTSD)",
   "name": "Daniel Mok",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle; back-to-the-wall seat by request",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the circle with Sister Anna and the others, my back against the wall as I requested. The dim light and the greenery outside the window help take the edge off, but with everyone's eyes occasionally on me and the fatigue from the morning weighing heavy, I keep my responses short and my gaze on the floor. The room feels safe enough, but I'm counting the minutes until we wrap up.",
   "waypoints": []
  }
 },
 "iris": {
  "agent": {
   "id": "cli_well_01",
   "age": 29,
   "gender": "female",
   "mbti": "ENFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.2,
   "clothing_insulation": 0.5,
   "anxiety": {
    "asi_score": 2,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "client (preventive wellness)",
   "name": "Iris Cheng",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle as a preventive-wellness participant",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I step into the Quiet Refuge2, curious about its design after the tea break. The dim light feels calming, but the warm air and low hum of noise make me aware of my tiredness. Sister Anna isn't here, so I'm just taking a moment alone before I head out.",
   "waypoints": [
    {
     "label": "WP1",
     "context": "photographing the courtyard planting before the session",
     "t_min": 20,
     "dwell_minutes": 5
    },
    {
     "label": "WP2",
     "context": "engaged in the circle, friendly with the facilitator",
     "t_min": 40,
     "dwell_minutes": 5
    },
    {
     "label": "WP3",
     "context": "lingering over tea, chatting with other clients",
     "t_min": 140,
     "dwell_minutes": 5
    },
    {
     "label": "WP4",
     "context": "peeks into the quiet refuge on the way out, curious about the design",
     "t_min": 175,
     "dwell_minutes": 5
    }
   ]
  }
 },
 "cherry": {
  "agent": {
   "id": "cli_dep_01",
   "age": 33,
   "gender": "female",
   "mbti": "INFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 0.9,
   "clothing_insulation": 0.7,
   "anxiety": {
    "asi_score": 27,
    "asi_level": "moderate",
    "modifiers": {
     "noise_sensitivity": 1.4,
     "thermal_comfort_range": 1.6,
     "personal_space_radius": 1.09,
     "enclosure_sensitivity": 1.5,
     "exit_proximity_need": 1.5
    }
   },
   "role": "client (mild depression)",
   "name": "Cherry Ng",
   "purpose_at_centre": "Member of Sister Anna’s Tuesday morning support circle; working through mild depression",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the circle with Sister Anna, Daniel, Patrick, and Vanessa, the dim light softening the edges of the room. The low hum of voices wraps around us as we take turns sharing, and I feel the weight of my own fatigue pressing in, but the green leaves outside the window offer a small anchor. My eyes drift to the window now and then, a quiet relief from the effort of being present.",
   "waypoints": []
  }
 },
 "mr_patrick": {
  "agent": {
   "id": "anx_gad_03",
   "age": 55,
   "gender": "male",
   "mbti": "ISTJ",
   "mobility": "normal",
   "hearing": "impaired",
   "vision": "severe_impairment",
   "metabolic_rate": 0.85,
   "clothing_insulation": 0.7,
   "anxiety": {
    "asi_score": 58,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (GAD, retired)",
   "name": "Mr Patrick Cheng",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle; recently retired civil servant working on retirement-onset anxiety",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the circle with Sister Anna and the others, trying to focus on the conversation, but my eyes keep drifting to the window and the greenery outside—it's a small relief. The room feels close, and even though the door is across the floor, I'm aware of it not being right behind me. My body is heavy from the morning, and the low hum of voices feels louder than it should, making it hard to settle into the discussion.",
   "waypoints": []
  }
 },
 "vanessa": {
  "agent": {
   "id": "anx_soc_03",
   "age": 31,
   "gender": "female",
   "mbti": "ISFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 60,
    "asi_level": "severe",
    "modifiers": {
     "noise_sensitivity": 1.6,
     "thermal_comfort_range": 1.9,
     "personal_space_radius": 1.15,
     "enclosure_sensitivity": 1.8,
     "exit_proximity_need": 1.9
    }
   },
   "role": "client (social anxiety)",
   "name": "Vanessa Yeung",
   "purpose_at_centre": "Member of Sister Anna's Tuesday morning anxiety circle",
   "relationships": [
    {
     "with": "staff_group_01",
     "type": "is_facilitator"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "Sister Anna has us in a circle, and I can feel the familiar tightness in my chest as I wait for my turn to speak. The greenery outside the window catches my eye, a small relief, but the hum of conversation and the closeness of the others makes my skin prickle. I keep my hands folded in my lap, trying to focus on breathing.",
   "waypoints": []
  }
 },
 "karen": {
  "agent": {
   "id": "comp_daughter_01",
   "age": 42,
   "gender": "female",
   "mbti": "ESFJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 33,
    "asi_level": "moderate",
    "modifiers": {
     "noise_sensitivity": 1.4,
     "thermal_comfort_range": 1.6,
     "personal_space_radius": 1.09,
     "enclosure_sensitivity": 1.5,
     "exit_proximity_need": 1.5
    }
   },
   "role": "client (caring for elderly mother, anticipatory grief)",
   "name": "Karen Chow",
   "purpose_at_centre": "Client of Sky Lam; I see her for anticipatory grief while caring for my elderly mother at home",
   "relationships": [
    {
     "with": "staff_art_01",
     "type": "is_clinician"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the Tea/Pause Area, trying to settle into the pause before my session with Sky, but my mind keeps drifting to my mother at home. The soft greenery outside the window catches my eye, offering a small moment of calm, yet the low hum of conversation around me—Mrs Tang, Pearl, Tomás—feels like a backdrop to my own quiet worry. I'm grateful for the break, but the weight of anticipatory grief makes it hard to fully relax.",
   "waypoints": []
  }
 },
 "tomas": {
  "agent": {
   "id": "cli_well_02",
   "age": 36,
   "gender": "male",
   "mbti": "ISFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.15,
   "clothing_insulation": 0.55,
   "anxiety": {
    "asi_score": 3,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "client (preventive wellness)",
   "name": "Tomás Ortega",
   "purpose_at_centre": "Preventive-wellness client of Dr Shum at the Centre",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_clinician"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm sitting in the Tea/Pause Area, trying to settle into the low hum of conversation around me. Mrs Tang, Pearl, and Karen are nearby, but Dr Shum isn't here yet, so I'm waiting with a quiet sense of anticipation. The greenery by the window catches my eye, offering a moment of calm, though my body feels heavy from the long wait.",
   "waypoints": []
  }
 },
 "janet": {
  "agent": {
   "id": "staff_admin_01",
   "age": 44,
   "gender": "female",
   "mbti": "ESTJ",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "mild_impairment",
   "metabolic_rate": 1,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 3,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "clinic_coordinator",
   "name": "Janet Wu",
   "purpose_at_centre": "Clinic coordinator at the Centre",
   "relationships": [
    {
     "with": "staff_ther_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_02",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_03",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_04",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_art_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_group_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_recep_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": true
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm in the staff lounge with Dr Shum and Dr Pang, catching a quick break between coordinating the morning schedule. The dim lighting and the low hum of conversation feel a bit straining after being on my feet for so long, and I notice my eyes are tired from the lack of natural light. I'm mentally running through the next round of appointments, trying to ignore the warmth in the room and the fatigue settling in my shoulders.",
   "waypoints": []
  }
 },
 "dr_adrian": {
  "agent": {
   "id": "staff_ther_04",
   "age": 33,
   "gender": "male",
   "mbti": "INFP",
   "mobility": "normal",
   "hearing": "normal",
   "vision": "normal",
   "metabolic_rate": 1.1,
   "clothing_insulation": 0.6,
   "anxiety": {
    "asi_score": 5,
    "asi_level": "normal",
    "modifiers": {
     "noise_sensitivity": 1,
     "thermal_comfort_range": 1,
     "personal_space_radius": 1,
     "enclosure_sensitivity": 1,
     "exit_proximity_need": 1
    }
   },
   "role": "therapist",
   "name": "Dr Adrian Pang",
   "purpose_at_centre": "Clinical psychologist at the Centre",
   "relationships": [
    {
     "with": "staff_admin_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_01",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_02",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_ther_03",
     "type": "is_colleague_of"
    },
    {
     "with": "staff_recep_01",
     "type": "is_colleague_of"
    }
   ],
   "goal_progress": 0,
   "trajectory_mode": false
  },
  "scenario": {
   "duration_in_cell": 180,
   "home_timestamp": "10:25",
   "original_summary": "I'm in the staff lounge with Ka Hei and Janet, catching a breather between sessions. The warm air and low chatter feel heavy on my tired body, but the greenery at the edge of my sight offers a small, quiet anchor. I'm grateful for this pause, even as my mind already sifts through the next client's notes.",
   "waypoints": []
  }
 }
};
