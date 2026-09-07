// What the atlas says about the cat, and what it says about itself.
//
// Everything here is text and constants. The geometry comes from the scans;
// this is the anatomy the scans are evidence for, plus the reading a viewer
// needs to know what they are looking at and what the scans cannot show.

export const GROUPS = {
  skull: { label: "Skull", color: 0xe6dcc8, order: 1 },
  axial: { label: "Axial skeleton", color: 0xdcd6c4, order: 2 },
  forelimb: { label: "Forelimb", color: 0xdfd4bd, order: 3 },
  hindlimb: { label: "Hindlimb", color: 0xd9d1bd, order: 4 },
  overview: { label: "Whole halves", color: 0xd5cfc0, order: 5 },
};

// Presets in Hounsfield units. The stored volume is windowed to [-1000, 2000]
// on the way out of the extractor, so these are the useful settings inside it.
export const WINDOWS = [
  { id: "bone", label: "Bone", center: 500, width: 2000 },
  { id: "soft", label: "Soft tissue", center: 50, width: 400 },
  { id: "full", label: "Everything", center: 500, width: 3000 },
];

/** Region notes. Each one says what the scan holds and what to look for in it.
 *  Nothing here claims a structure the surface does not show. */
export const REGION_NOTES = {
  head: {
    summary:
      "The skull with the mandible in place and the atlas behind it, at 0.157 mm voxels. This is the finest scan in the set and the one that carries most of the teachable detail.",
    look: [
      "The zygomatic arch stands clear of the braincase, leaving the wide temporal fossa that the temporalis fills. The postorbital process of the frontal bone and the one on the zygomatic point at each other but do not meet: the cat's orbit is open behind, closed in life by the orbital ligament rather than by bone.",
      "The rounded swelling under the back of the skull is the tympanic bulla. In cats it is unusually large and is divided inside by a bony septum into two chambers, which the transverse slices show better than the surface does.",
      "The upper fourth premolar and the lower first molar are the carnassial pair. They are the two teeth that shear against each other, and they sit at the back of the tooth row where the jaw closes hardest.",
      "The mandible is two halves. They meet at the front in a fibrous symphysis, not a fused joint, so on the surface they read as one bone only where the scan resolution blurs the seam.",
    ],
  },
  cervical: {
    summary:
      "The seven cervical vertebrae, C1 to C7, scanned as a column at 0.157 mm voxels.",
    look: [
      "C1, the atlas, has no body and no spinous process. Its transverse processes are the broad flat wings that make the widest part of the neck skeleton.",
      "C2, the axis, carries the dens forward into the atlas and has the longest spinous process in the neck, a blade that runs most of the length of the bone.",
      "From C3 back, the spinous processes grow and the transverse processes shrink. C6 has the broad ventral lamina; C7 is the one with no transverse foramen.",
    ],
  },
  thoracic: {
    summary:
      "Thoracic vertebrae with the heads and proximal shafts of their ribs, at 0.157 mm voxels. The cat has thirteen thoracic vertebrae and thirteen pairs of ribs.",
    look: [
      "Each rib head meets the vertebral column at two points: the head on the bodies of two neighboring vertebrae, the tubercle on the transverse process of the caudal one. Both facets are visible on the surface.",
      "The spinous processes lean backward over the front of the thorax and stand upright near its end. The vertebra where the lean changes is the anticlinal vertebra, usually the tenth in the cat.",
    ],
  },
  lumbar: {
    summary: "The seven lumbar vertebrae at 0.157 mm voxels.",
    look: [
      "Lumbar vertebrae are the longest in the column and carry the largest transverse processes, which sweep forward and down. There are no ribs and no transverse foramina here.",
      "The accessory and mammillary processes on the cranial articular surfaces are what lock one lumbar vertebra to the next and limit how far the back can twist.",
    ],
  },
  pelvis: {
    summary:
      "The pelvis with the sacrum and the first caudal vertebrae, at 0.157 mm voxels.",
    look: [
      "The sacrum is three fused vertebrae. Its wings meet the ilium at the sacroiliac joint, the only bony connection between the hind limb and the vertebral column.",
      "Each hip bone is three bones fused at the acetabulum: ilium in front, ischium behind, pubis below. The suture lines close early and the acetabulum is where all three meet.",
      "The obturator foramen is the large opening below the acetabulum, bounded by pubis and ischium.",
    ],
  },
  shoulder: {
    summary:
      "The left shoulder: scapula, the head of the humerus and the ribs behind them, at 0.167 mm voxels.",
    look: [
      "The scapular spine divides the lateral face into the supraspinous and infraspinous fossae. It ends in the acromion, which in the cat carries two processes rather than one.",
      "The glenoid cavity is shallow. The shoulder is held by muscle rather than by bone or by a deep socket, which is what lets the forelimb rotate as far as it does.",
      "There is no bony joint between the forelimb and the trunk. The cat's clavicle is a small free bone in muscle and does not reach the sternum.",
    ],
  },
  forearm: {
    summary: "The radius, ulna, carpus and manus at 0.167 mm voxels.",
    look: [
      "The radius and ulna are separate along their whole length and cross over each other. That is what allows supination and pronation, and it is why a cat can turn a paw palm up.",
      "The olecranon is the proximal end of the ulna, the point of the elbow and the lever the triceps pulls on.",
      "The manus has five digits. The first is the dewclaw, short and set well back from the others, and it does not reach the ground.",
      "The last phalanx of each digit carries the claw. Its shape is the hood the claw sheath grows from, and the joint behind it is where the claw is drawn back.",
    ],
  },
  femur: {
    summary: "The right femur with the knee, at 0.286 mm voxels, the coarsest of the regional scans.",
    look: [
      "The femoral head is nearly a full hemisphere on a short neck, set at an angle to the shaft. The fovea on the head is where the ligament of the head of the femur attaches.",
      "The greater trochanter stands proud beside the head; the lesser trochanter is on the medial side further down.",
      "The patella rides in the trochlear groove at the far end. Behind the femorotibial joint, the two small fabellae sit in the heads of the gastrocnemius.",
    ],
  },
  crus: {
    summary:
      "MorphoSource records this series as the tibia and fibula, at 0.179 mm voxels. The field is 247 mm long and holds the whole lower hind limb rather than those two bones alone; it overlaps heavily with the pes scan, which was acquired with the same geometry over much the same piece of the specimen.",
    look: [
      "The tibia takes the weight. The fibula is a thin strut alongside it, attached at both ends and fused to nothing along its length, and the gap between the two runs most of the shaft.",
      "The tibial crest is the ridge on the front of the proximal tibia. It is where the patellar ligament ends and so where the whole extensor mechanism of the knee pulls.",
      "The medial malleolus on the tibia and the lateral malleolus on the fibula form the socket of the hock.",
      "Which end of this field is proximal is not recorded anywhere in the scan, and the atlas does not guess. Compare it against the pes scan and against the caudal half of the body.",
    ],
  },
  pes: {
    summary:
      "MorphoSource records this series as the left pes, at 0.179 mm voxels. The field is 241 mm long, far longer than a cat's hind foot, so it holds the foot together with the leg above it, and it overlaps heavily with the tibia and fibula scan.",
    look: [
      "The calcaneus projects backward as the calcaneal tuber, the point of the hock and the insertion of the common calcanean tendon. It is the most obvious single process in the hind foot.",
      "The talus articulates with the tibia above and the calcaneus below. The trochlea on its upper surface is the running surface of the hock joint.",
      "The hind foot has four digits. The first is absent, unlike the forefoot, which is the clearest skeletal difference between a cat's front and back paws.",
      "The cat stands on its digits. The metatarsals are held off the ground and the tarsus rides high, which is why the hock looks like a backward bending knee.",
    ],
  },
  rostral: {
    summary:
      "The front half of the body at 0.444 mm voxels: skull, neck, thorax with the ribs, and the shoulder girdle.",
    look: [
      "This scan and its caudal counterpart are the only ones that show more than one region at a time. They are coarser than the regional scans by a factor of about three.",
      "The rib cage is narrow side to side and deep top to bottom. A cat's thorax is built to pass through a gap the width of its head.",
      "The scapula lies flat against the rib cage and is held there by muscle. Watch how far forward and back it reaches across the ribs.",
    ],
  },
  caudal: {
    summary:
      "The back half of the body at 0.444 mm voxels: lumbar column, pelvis, hind limb and the tail.",
    look: [
      "The lumbar column is long and mobile. It is the part of the skeleton that lets the back arch and extend through a bound, and it carries most of the reach in a running stride.",
      "The caudal vertebrae shorten and simplify along the tail. The arches and processes disappear first, leaving cylinders of bone toward the tip.",
    ],
  },
};

/** The reference section. Short, sourced in the skeleton itself, and limited
 *  to what a reader can go and check on the scans in this atlas. */
export const REFERENCE = [
  {
    id: "formulae",
    title: "The counts",
    rows: [
      ["Vertebral formula", "C7 T13 L7 S3 Cd 18 to 23"],
      ["Ribs", "13 pairs. Nine reach the sternum, three join the costal arch, the last ends free"],
      ["Sternum", "Eight segments: manubrium, six sternebrae, xiphoid process"],
      ["Adult dental formula", "I 3/3, C 1/1, P 3/2, M 1/1, times two, is 30 teeth"],
      ["Deciduous dental formula", "I 3/3, C 1/1, P 3/2, times two, is 26 teeth"],
      ["Carnassial pair", "Upper fourth premolar against lower first molar"],
      ["Digits", "Five on each forefoot, the first a dewclaw. Four on each hind foot"],
      ["Stance", "Digitigrade. The carpus and tarsus are carried clear of the ground"],
    ],
  },
  {
    id: "skull",
    title: "The skull",
    body: [
      "The cat's skull is short in front and wide across the back. The facial part is compressed, which shortens the jaw into a lever that closes fast and hard over a small number of teeth, and it puts the eyes forward for overlapping fields of view.",
      "The orbit is not closed behind by bone. The postorbital process of the frontal and the one on the zygomatic reach toward each other and stop; an orbital ligament spans the gap. The temporal fossa behind the orbit is continuous with it.",
      "The tympanic bulla is large and, in cats, divided by a septum into two chambers. The bulla is the most reliable feature for telling a felid skull from a similarly sized carnivoran of another family.",
      "The mandible is two separate bones joined at the front by the mandibular symphysis, which stays fibrous. The condylar process is a transverse cylinder set in a tight socket, which allows a hinge and almost no grinding movement.",
    ],
  },
  {
    id: "vertebral",
    title: "The vertebral column",
    body: [
      "Seven cervical vertebrae carry the head. The atlas has no body, no spinous process and broad wings; the axis has a dens that projects into the atlas and the longest spinous process in the neck. Between them they hold nearly all of the head's nodding and turning.",
      "Thirteen thoracic vertebrae carry the ribs, each rib meeting the column at two facets. The spinous processes lean backward at the front of the chest and stand upright at about the tenth, the anticlinal vertebra.",
      "Seven lumbar vertebrae make the longest and most mobile part of the back. Their transverse processes sweep forward and their bodies are the longest in the column.",
      "Three sacral vertebrae fuse into the sacrum and meet the ilium. Behind them the caudal vertebrae, usually about twenty, taper off into simple cylinders.",
    ],
  },
  {
    id: "limbs",
    title: "The limbs",
    body: [
      "The forelimb has no bony attachment to the trunk. The clavicle is a small free bone lying in the brachiocephalicus and reaching neither the sternum nor the scapula, so the whole limb is slung on muscle. That is what absorbs a landing and what lets the shoulder move as far forward as it does.",
      "The radius and ulna stay separate and cross, so the forepaw supinates. The hind limb has no equivalent: the tibia carries the load and the fibula is a slender strut that adds no rotation.",
      "Both feet are digitigrade. The metacarpus and metatarsus stand off the ground, which is why the hock and the carpus sit high on the leg and read as extra joints.",
      "Every digit ends in a phalanx shaped as a hood for the claw. In the cat that joint holds the claw retracted at rest and is released to extend it, which is why the claws stay sharp.",
    ],
  },
];

/** What this atlas is not, stated where a reader will meet it. */
export const LIMITS = [
  "The specimen was scanned in pieces. The twelve series were acquired separately, each with its own frame of reference, and nothing in the data relates one to another. There is no assembled skeleton here, and there cannot be one without registration this atlas does not attempt.",
  "Bones are not separated from one another. In a specimen with its joints intact the articular surfaces touch, so a threshold that follows bone returns one connected surface per region: the head comes back as skull, mandible and atlas together. Naming individual bones would mean segmenting them, which this atlas does not do. The anatomy is named by landmarks placed on the surface instead.",
  "A scan's field can hold more than the part it is named for. The series are named for what they were acquired to show, and several of them reach well past it: the tibia and fibula and the left pes were acquired with the same geometry over much the same piece of the hind limb, and each field is about 245 mm long. Where the atlas cannot say which end of a field is which, it says so rather than guessing.",
  "The surfaces are thresholds, not segmentations. Everything denser than the level shown for each region is inside the surface, including tooth enamel, mineralized cartilage and any part of the mount that reads as dense as bone.",
  "Soft tissue is on the slices, not on the surface. The specimen was scanned wrapped, and no threshold separates the wrapping from the animal, so no soft tissue surface is offered. What the scan holds of the soft tissue is in the slice viewer.",
];
