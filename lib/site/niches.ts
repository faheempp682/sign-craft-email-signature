/**
 * Content for the /for/[niche] pages. Each niche is written from that profession's actual problems, so the pages are
 * genuinely different, not one template with the nouns swapped. Brand names are never written here: pages inject them.
 * Compatibility claims are never written here either: see lib/site/claims.ts.
 */
import { claimText } from "./claims";
import type { FaqItem } from "./seo";

export type Niche = {
  slug: "recruiters" | "real-estate" | "freelancers" | "agencies";
  label: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lead: string;
  /** Preset id from lib/presets.ts shown as the example. */
  presetId: string;
  presetCaption: string;
  painsHeading: string;
  pains: { title: string; body: string }[];
  includeHeading: string;
  include: { title: string; body: string }[];
  mistakesHeading: string;
  mistakes: string[];
  faq: FaqItem[];
  ctaHeading: string;
  ctaBody: string;
};

export const NICHES: Niche[] = [
  {
    slug: "recruiters",
    label: "Recruiters",
    metaTitle: "Email signature for recruiters",
    metaDescription: "A recruiter email signature that gets replies: a booking link, a clear specialism, a short privacy line and a layout that stays narrow in busy inboxes.",
    h1: "An email signature for recruiters that makes replying the easy part",
    lead: "You send dozens of messages a day to people who skim. The signature is the one block that is on every message, so it should answer the next question before anyone asks it: who are you hiring for, and how do I get time with you?",
    presetId: "studio-009",
    presetCaption: "A clean card with a photo, direct line and social links, the pattern candidates recognise.",
    painsHeading: "What goes wrong with recruiter signatures",
    pains: [
      { title: "Candidates cannot tell what you recruit for", body: "A bare job title like \"Talent Partner\" does not say whether you place engineers or finance leads. A specialism line next to the title lets a candidate decide in a second whether to reply." },
      { title: "Scheduling takes four emails", body: "Without a booking link, a first call turns into a thread of proposed times. One visible link in the signature removes most of that back-and-forth." },
      { title: "Hiring-manager and candidate emails need different signatures", body: "To a client you want company credentials; to a candidate you want warmth and a direct number. One signature rarely serves both, so keep two and switch." },
      { title: "A long legal footer buries your contact details", body: "Agencies often append paragraphs of text under the signature. Keep the footer to one or two lines so your phone number is not pushed off the screen on a phone." },
    ],
    includeHeading: "What a recruiter signature should carry",
    include: [
      { title: "Name, role and specialism", body: "For example \"Technical recruiter, data and platform roles\". Specific beats senior-sounding." },
      { title: "A direct phone or WhatsApp number", body: "Candidates often reply from a phone between meetings. Make the number tappable." },
      { title: "A booking link, labelled with what it is", body: "\"Book a 15 minute intro\" gets used more than a bare calendar URL." },
      { title: "LinkedIn", body: "It is where candidates check you are real. Link the profile, not the company page." },
      { title: "One short privacy or confidentiality line", body: "If your firm requires one, keep it short and ask your compliance contact for the approved wording." },
    ],
    mistakesHeading: "Common recruiter signature mistakes",
    mistakes: [
      "Using a large banner image. Many inboxes hide images by default, so the banner shows as an empty box.",
      "Listing five phone numbers. Pick the one you actually answer.",
      "Putting a job advert in the signature. Adverts go stale; a link to your open roles page does not.",
    ],
    faq: [
      { q: "Should a recruiter signature include a photo?", a: "Many candidates respond better to a face they can match to a LinkedIn profile, but it is optional. If your agency has a policy on photos, follow it. Templates with and without a photo are available." },
      { q: "How long should the signature be?", a: "Aim for four to six lines. Name, role, one contact route, one link. Anything beyond that is read by nobody on a phone." },
      { q: "Can I keep one signature for clients and another for candidates?", a: "Yes. Make two with the same layout, and put the booking link first in the candidate one and your company details first in the client one." },
      { q: "Is the free generator enough for me?", a: "For one person it is. You can build, copy and paste it into your mail app without an account. An account adds saving, AI autofill from pasted text or your website, and team features for agencies." },
    ],
    ctaHeading: "Build your recruiter signature in a couple of minutes",
    ctaBody: "Pick a card, add your details and booking link, and copy it into your mail app. No account needed.",
  },
  {
    slug: "real-estate",
    label: "Real estate agents",
    metaTitle: "Email signature for real estate agents",
    metaDescription: "A real estate agent email signature with licence number, brokerage details, a listing banner and a mobile-friendly layout. Free generator, no sign-up needed.",
    h1: "An email signature for real estate agents that works while you are at a viewing",
    lead: "Most of your emails are read on a phone, by people who are comparing you with two other agents. Your signature needs to look established, carry the details your brokerage requires, and put your latest listing or valuation offer one tap away.",
    presetId: "listing-banner",
    presetCaption: "A headshot, tappable contact rows and room for a listing or valuation banner.",
    painsHeading: "What goes wrong with agent signatures",
    pains: [
      { title: "Brokerage and licence details are missing or inconsistent", body: "Brokerages and regulators often expect a licence number or registration in correspondence. When each agent adds it by hand, it ends up in five different formats." },
      { title: "Listing banners go stale", body: "A banner promoting a property that sold last month looks careless. Treat the banner as something you refresh on a schedule, not a permanent fixture." },
      { title: "Heavy images make the email load slowly on mobile data", body: "A full-width photo of a house in the signature repeats on every reply in a thread. Small, optimised images keep threads light." },
      { title: "Buyers cannot tell which area you cover", body: "\"Real estate advisor\" says nothing. A line such as \"Residential sales, north side and the harbour district\" does." },
    ],
    includeHeading: "What an agent signature should carry",
    include: [
      { title: "Name, role and the areas you cover", body: "Buyers and sellers search by place. Say where you work." },
      { title: "Licence or registration number", body: "Where your regulator or brokerage asks for it. Check the exact wording with your brokerage; this tool cannot tell you what your jurisdiction requires." },
      { title: "Brokerage name and logo", body: "A small logo is enough. Host it at an https address so mail apps can load it." },
      { title: "One call to action", body: "\"Request a free valuation\" or \"See my current listings\", linked to a page that is kept up to date." },
      { title: "Mobile number, tappable", body: "Agents are called while on the move. A tap-to-call number saves a step." },
    ],
    mistakesHeading: "Common agent signature mistakes",
    mistakes: [
      "Linking the banner to a listing that has since sold. Link to your listings page instead.",
      "Using a photo-only signature. If images are blocked, the details must still be readable as text.",
      "Leaving out the brokerage name because it \"is on the website\". Recipients forward emails; the signature has to stand alone.",
    ],
    faq: [
      { q: "Can I add my licence number to the signature?", a: "Yes, put it in the company or title line, or a short line under your details. Your brokerage or regulator may prescribe the wording, so confirm it with them." },
      { q: "Can I put a listing banner in the signature?", a: "Yes. In the free generator you can reference a photo you already host. Hosting banner images for you and managing them is part of the signed-in product." },
      { q: "Will it work with my brokerage's required footer?", a: "The signature is separate from any footer your mail system appends. If your brokerage appends a legal footer centrally, it will appear under your signature." },
      { q: "Is it free?", a: "The generator is free and needs no account. Saving signatures, AI autofill and team features need an account." },
    ],
    ctaHeading: "Make an agent signature you can paste into your mail app",
    ctaBody: "Choose a layout, add your licence and brokerage details, and copy it. It runs in your browser; nothing is uploaded.",
  },
  {
    slug: "freelancers",
    label: "Freelancers",
    metaTitle: "Email signature for freelancers",
    metaDescription: "A freelancer email signature that sells without shouting: what you do, a portfolio link, a way to book you, and a light layout. Free generator, no account.",
    h1: "An email signature for freelancers that does a little selling for you",
    lead: "You are your own marketing department, and every email to a client, a prospect or an old contact is a free impression. A good freelance signature says what you do, shows you are currently taking work, and links to your best proof, without looking like an advert.",
    presetId: "studio-003",
    presetCaption: "A personal, designer-friendly card with a photo and a short link row.",
    painsHeading: "What goes wrong with freelancer signatures",
    pains: [
      { title: "\"Freelancer\" is not a service", body: "Clients hire a result, not a status. \"Brand designer for early-stage food companies\" tells a forwarded email's reader exactly who to call." },
      { title: "The portfolio link is buried or missing", body: "Your best work is your best pitch. One link, to a page curated for what you want more of, beats a row of seven social icons." },
      { title: "You look less established than you are", body: "Without a company line or a custom-domain address, a solo practitioner can read as a hobby. Using your own domain and a consistent layout does most of the work." },
      { title: "It never gets updated", body: "Availability, your rate of focus and your best project change. A signature you can edit in a minute is a signature you will keep current." },
    ],
    includeHeading: "What a freelancer signature should carry",
    include: [
      { title: "Your name and a specific service line", body: "Who you help and with what, in one line." },
      { title: "A single portfolio or case-study link", body: "Link the page you would show a prospect today, not the home page of a site you are redesigning." },
      { title: "A way to book a call", body: "\"Book a 20 minute call\" removes the friction of asking." },
      { title: "Your own domain address", body: "name@yourstudio.com reads as a business; a generic webmail address does not always." },
      { title: "Only the social links clients use", body: "Pick the one or two networks where your work lives. Skip the rest." },
    ],
    mistakesHeading: "Common freelancer signature mistakes",
    mistakes: [
      "Quoting \"available for projects\" and never changing it. If it is wrong, it hurts more than saying nothing.",
      "Using a logo made of text inside an image. If images are off, your name vanishes. Keep the name as real text.",
      "Adding a motivational quote. It adds length, not credibility.",
    ],
    faq: [
      { q: "Do I need a logo?", a: "No. A clean name, service line and link row is enough. A logo helps if clients already know it; use a small one hosted over https." },
      { q: "Should I use a photo?", a: "A photo helps when clients buy you, not a product. It is optional; pick a template with or without one." },
      { q: "Can I use it from a free webmail account?", a: "You can paste the signature into any mail app that accepts rich-text signatures. How each app handles it differs, and we have not yet verified every client, so check by sending yourself a test message." },
      { q: "Do I have to sign up?", a: "No. The generator needs no account. Sign up only if you want to save versions, use AI autofill, or share templates with others." },
    ],
    ctaHeading: "Build a signature that carries your portfolio link",
    ctaBody: "Start from a template, drop in your details and accent colour, and copy it into your mail app. Free, in your browser.",
  },
  {
    slug: "agencies",
    label: "Agencies and teams",
    metaTitle: "Email signature management for agencies and teams",
    metaDescription: "Keep every person at your agency on the same on-brand email signature: one design, correct details per person, and a safe way to roll out changes.",
    h1: "Email signatures for agencies where every person looks like one company",
    lead: "At twenty people, signatures drift: three fonts, four logo sizes, an old rebrand still going out from someone's laptop. The cost is quiet but real, because your emails are among the most-seen brand surfaces you have. The fix is one approved design, filled with each person's details.",
    presetId: "studio-019",
    presetCaption: "A brand-led card with a photo, role and contact rows that scales across a team.",
    painsHeading: "What goes wrong with team signatures",
    pains: [
      { title: "Everyone builds their own", body: "People copy a colleague's, tweak a colour and add a quote. A year later no two match, and nobody remembers which is current." },
      { title: "Rebrands are never fully rolled out", body: "Changing a logo means asking every person to paste a new signature. Some will, some will not, and old ones keep circulating." },
      { title: "New starters wait for someone to set theirs up", body: "A new joiner's first emails go out unsigned or with a stale template because setup is a favour someone has to do." },
      { title: "Client-facing and internal roles need different details", body: "Account managers need a booking link; developers may only need a name and role. One rigid template either overloads or underserves." },
    ],
    includeHeading: "What a team signature standard should cover",
    include: [
      { title: "One approved layout and palette", body: "Decide once: logo size, font, colours, spacing. Everything else is data." },
      { title: "The same fields for everyone", body: "Name, role, phone, email, plus an optional booking link per person. Fewer free-text fields means less drift." },
      { title: "A named owner for changes", body: "One person (or a small group) approves changes, so the standard does not erode." },
      { title: "A plan for banners and campaigns", body: "Promotional banners should be switched on and off for everyone together, with an end date, not pasted by hand." },
      { title: "A roll-out check", body: "After any change, send a test to a few mail apps used at your company and look at it." },
    ],
    mistakesHeading: "Common agency signature mistakes",
    mistakes: [
      "Asking everyone to \"just update it\". Without a shared source it will not happen uniformly.",
      "Letting each person upload their own logo file. Sizes and formats vary and some will be oversized.",
      "Skipping a test. Mail apps differ, and the only dependable way to know is to look.",
    ],
    faq: [
      { q: "Can the free generator manage a whole team?", a: "No. It makes one signature at a time in your browser and keeps nothing. For shared templates, saving and team features you need an account." },
      { q: "Does this replace a central signature service?", a: "That depends on what you need. Enterprise tools append signatures centrally on the mail server. Ours is built around designing well-formed signatures and handing them out." },
      { q: "How do we keep a rebrand consistent?", a: `Change the approved template once and have everyone re-copy it. ${claimText("gmailPush")}` },
      { q: "Can we try it before deciding?", a: "Yes: build a signature in the free generator for one person and send a test to the mail apps your team uses. That tells you more than any feature list." },
    ],
    ctaHeading: "Start by designing the one signature your team will share",
    ctaBody: "Build it in the free generator, test it in your mail apps, then sign in to save it and set up your team.",
  },
];

export const NICHE_SLUGS = NICHES.map((n) => n.slug);

export function getNiche(slug: string): Niche | undefined {
  return NICHES.find((n) => n.slug === slug);
}
