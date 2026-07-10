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
] as const;

export const DISABLED_RULE_NOTES = [
  "Aquarium is disabled for Matching by the SF rules, but enabled for Measuring.",
  "Farmers Market is ingested but disabled because the rules doc marks it untested.",
  "Street/path, sea level, body of water, and photo questions need additional frozen geometry layers before they can be adjudicated safely.",
] as const;
