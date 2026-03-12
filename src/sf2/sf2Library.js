const SF2_TRACK_OPTIONS = [
  {
    value: new URL("../../sf2 files/1_M3R_Jazz_Organ.SF2", import.meta.url).href,
    label: "M3R Jazz Organ"
  },
  {
    value: new URL("../../sf2 files/kurz_strings_32khz.SF2", import.meta.url).href,
    label: "Kurz Strings"
  },
  {
    value: new URL("../../sf2 files/Open_Diapason_Pipe_Organ.sf2.sf2", import.meta.url).href,
    label: "Open Diapason Pipe Organ"
  },
  {
    value: new URL("../../sf2 files/projectsam_world_percussion.sf2", import.meta.url).href,
    label: "ProjectSAM World Percussion"
  },
  {
    value: new URL("../../sf2 files/Stein Grand Piano.SF2", import.meta.url).href,
    label: "Stein Grand Piano"
  },
  {
    value: new URL("../../sf2 files/1115_Korg_IS50_Marimboyd.sf2", import.meta.url).href,
    label: "Korg IS50 (Marimboyd)"
  },
  {
    value: new URL("../../sf2 files/choir sf2/Dave'sMaleOohs.sf2", import.meta.url).href,
    label: "Choir: Dave's Male Oohs",
    family: "choir"
  },
  {
    value: new URL("../../sf2 files/choir sf2/GothicVox.sf2", import.meta.url).href,
    label: "Choir: Gothic Vox",
    family: "choir"
  },
  {
    value: new URL("../../sf2 files/choir sf2/OperaSingerFemale1.sf2", import.meta.url).href,
    label: "Choir: Opera Singer Female 1",
    family: "choir"
  },
  {
    value: new URL("../../sf2 files/choir sf2/OperaSingerFemale2.sf2", import.meta.url).href,
    label: "Choir: Opera Singer Female 2",
    family: "choir"
  },
  {
    value: new URL("../../sf2 files/Acoustic Bass FBG29 MW_1.SF2", import.meta.url).href,
    label: "Acoustic Bass FBG29"
  }
];

export const DEFAULT_GENERIC_SF2_PATH = SF2_TRACK_OPTIONS[0]?.value || "";

export function getSf2TrackOptions() {
  return SF2_TRACK_OPTIONS.map((option) => ({ ...option }));
}

export function isChoirSf2Path(path) {
  const safePath = String(path || "").trim();
  return SF2_TRACK_OPTIONS.some(
    (option) => option.family === "choir" && option.value === safePath
  );
}
