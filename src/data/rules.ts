export const CATEGORY_LABELS = {
  railStations: "Rail station",
  mountains: "Mountain",
  dogParks: "Dog park",
  aquariums: "Aquarium",
  golfCourses: "Golf course",
  museums: "Museum",
  movieTheaters: "Movie theater",
  libraries: "Library",
  hospitals: "Hospital",
  foreignConsulates: "Foreign consulate",
  farmersMarkets: "Farmers market",
  coastline: "Coastline",
} as const;

export const MATCHING_CATEGORIES = [
  "mountains",
  "dogParks",
  "golfCourses",
  "museums",
  "movieTheaters",
  "libraries",
  "hospitals",
  "foreignConsulates",
  "farmersMarkets",
] as const;

export const MEASURING_CATEGORIES = [
  "railStations",
  "mountains",
  "dogParks",
  "aquariums",
  "golfCourses",
  "museums",
  "movieTheaters",
  "libraries",
  "hospitals",
  "foreignConsulates",
  "farmersMarkets",
  "coastline",
] as const;

export const TENTACLE_CATEGORIES = [
  "railStations",
  "mountains",
  "dogParks",
  "aquariums",
  "golfCourses",
  "museums",
  "movieTheaters",
  "libraries",
  "hospitals",
  "foreignConsulates",
  "farmersMarkets",
] as const;

export const DISABLED_RULE_NOTES = [
  "Aquarium is disabled for Matching by the SF rules, but enabled for Measuring.",
  "Farmers Market is enabled from the frozen sheet data, but the rules doc marks this homebrew question untested.",
  "Street/path, sea level, body of water, residential parking permit zone, and photo questions need additional frozen geometry layers before they can be adjudicated safely.",
] as const;

export const UNSUPPORTED_QUESTIONS = [
  {
    name: "Sea level",
    reason: "Needs a frozen elevation surface or contour-derived elevation layer.",
  },
  {
    name: "Body of water",
    reason: "Needs a frozen waterbody polygon/line layer matching what counts as blue on the map.",
  },
  {
    name: "Street or path",
    reason: "Needs a frozen street/path network and tracing rules.",
  },
  {
    name: "Residential parking permit zone",
    reason: "Needs frozen RPP zone polygons/colors.",
  },
  {
    name: "Photo questions",
    reason: "Require hider-provided photos or additional object-specific datasets.",
  },
] as const;
