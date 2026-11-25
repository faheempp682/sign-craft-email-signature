import { getBrand } from "@/lib/brand";
import { pageMetadata } from "@/lib/site/seo";
import { ContactLine, LegalDoc, Operator, Todo, type LegalSection } from "../legal";

export function generateMetadata() {
  return pageMetadata({ path: "/privacy", title: "Privacy policy", description: "What personal data the service handles, who processes it, how long it is kept and how to exercise your rights." });
}

export default function PrivacyPage() {
  const brand = getBrand();
  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who we are",
      body: (
        <>
          <p>
            {brand.name} (&quot;the service&quot;) is operated by <Operator brand={brand} />
            {brand.address ? <>, {brand.address}</> : null}. For anything in this policy, contact <ContactLine brand={brand} />.
          </p>
          <p>
            This policy covers this website, the free signature generator, and the signed-in application. Items shown in <Todo>square brackets</Todo> are details the operator still has to decide or confirm before this policy is published.
          </p>
        </>
      ),
    },
    {
      id: "generator",
      title: "The free generator",
      body: (
        <p>
          The free signature generator runs entirely in your browser. What you type is not sent to our servers, nothing is uploaded, no AI is used, and the page sets no cookies of its own and writes nothing to your browser storage. When you close the tab, it is gone. If you give the generator a link to a photo, your browser loads that image directly from the address you gave.
        </p>
      ),
    },
    {
      id: "collect",
      title: "What we store when you have an account",
      body: (
        <>
          <ul>
            <li>Your email address and the sign-in identifiers created by our authentication provider.</li>
            <li>Your role in the service and your settings (for example which features are switched on for you).</li>
            <li>The signatures you create. These contain what you enter: name, job title, company, phone, email, website, address and social links, plus the design choices.</li>
            <li>Images you upload (photos, logos, banners), after we resize and re-encode them.</li>
            <li>Counters of how often you use limited features such as AI, so that daily limits can be applied.</li>
            <li>If you connect Google (optional, see below): the Google account email and an encrypted access grant.</li>
          </ul>
          <p>
            Signatures and images belong to you. We use them to provide the service to you and your organisation, and for no advertising purpose. <Todo>Operator: confirm whether any product analytics or error logging is added, and list it here</Todo>
          </p>
        </>
      ),
    },
    {
      id: "providers",
      title: "Who processes data for us",
      body: (
        <>
          <p>We use these providers to run the service. Each handles data under its own terms and privacy policy.</p>
          <ul>
            <li>
              <strong>Supabase</strong>: database and sign-in, holding your account, signatures and settings.
            </li>
            <li>
              <strong>Bunny.net (CDN and storage)</strong>: hosts the images you upload. See &quot;Images&quot;.
            </li>
            <li>
              <strong>Anthropic</strong>: processes the content you submit to AI features. See &quot;AI features&quot;.
            </li>
            <li>
              <strong>Google</strong>: only if you choose to connect your Google Workspace account.
            </li>
            <li>
              <strong>Our hosting provider</strong>: <Todo>Operator: name the hosting provider and region</Todo>
            </li>
          </ul>
          <p>
            These providers may process data outside your country. <Todo>Operator and lawyer: add the transfer mechanism that applies, for example standard contractual clauses</Todo>
          </p>
        </>
      ),
    },
    {
      id: "ai",
      title: "AI features",
      body: (
        <>
          <p>When you use an AI feature, the content you provide for it is sent to Anthropic&apos;s API to produce a result, and the result comes back to you. Depending on the feature, that content is:</p>
          <ul>
            <li>text you paste (for example an old signature or a profile) for autofill;</li>
            <li>the text of a web page whose address you give us, which our server fetches for you;</li>
            <li>a screenshot or image you upload, to be read and turned into a signature draft;</li>
            <li>a description of the design you want.</li>
          </ul>
          <p>
            Do not submit personal data about other people unless you have a right to. AI output can be wrong, so review it before you use it. How Anthropic handles API data is governed by Anthropic&apos;s own terms and privacy policy, which you should read. <Todo>Operator: confirm retention and training terms of the Anthropic account in use, and state them here</Todo> AI features are available to signed-in people only, and are limited per person.
          </p>
        </>
      ),
    },
    {
      id: "images",
      title: "Images",
      body: (
        <p>
          Signatures work by pointing to images hosted online, so mail apps can show them. Images you upload are therefore stored on a CDN and served from a web address that does not require sign-in. <strong>Anyone who has an image&apos;s link can view it</strong>, and recipients of your emails receive that link. Do not upload images you want to keep private. <Todo>Operator: confirm how deleted images are removed from the CDN and from its cache</Todo>
        </p>
      ),
    },
    {
      id: "recipients",
      title: "People who receive your signature",
      body: (
        <p>
          When a recipient opens an email, their mail app may request the images in your signature from our CDN, and the CDN&apos;s servers can see ordinary request data such as an IP address. If you use optional features such as click-tracked links or a digital card page, a recipient following such a link visits our servers. <Todo>Operator: describe exactly what, if anything, is recorded about recipients once these features ship, and the legal basis</Todo>
        </p>
      ),
    },
    {
      id: "google",
      title: "Google connection (optional)",
      body: (
        <>
          <p>If you press &quot;Connect Google account&quot; to send a signature to Gmail, we ask Google for these permissions and no others:</p>
          <ul>
            <li>
              <strong>openid</strong> and <strong>email</strong>: to know which Google account you connected.
            </li>
            <li>
              <strong>Gmail basic settings</strong> (the gmail.settings.basic scope): to read your current signature for comparison and to replace it after you confirm. Google describes this as viewing and managing basic Gmail settings. We do not read or send your mail with it.
            </li>
          </ul>
          <p>
            Only Google Workspace accounts on the domains the operator allows can connect. The long-lived grant is encrypted before storage, and the signature is only changed after you review and confirm it. You can disconnect at any time, which revokes the grant with Google and deletes what we stored. You can also remove access in your Google account settings. <Todo>Operator: confirm this feature&apos;s status and Google&apos;s OAuth verification before relying on this section</Todo>
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies and similar technologies",
      body: (
        <>
          <ul>
            <li>
              <strong>Sign-in session cookies</strong>, set by our authentication provider only when you sign in, so you stay signed in.
            </li>
            <li>
              <strong>A short-lived security cookie</strong> used during the optional Google connection to protect the sign-in step.
            </li>
          </ul>
          <p>
            These are strictly necessary for features you ask for. The public pages, including the free generator, set no cookies of their own. We do not use advertising cookies. <Todo>Operator: if analytics are added later, update this section and consider whether consent is required</Todo>
          </p>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long we keep data",
      body: (
        <>
          <ul>
            <li>Account, signatures and settings: for as long as your account exists, or until you delete them.</li>
            <li>Uploaded images: until you remove them or your account is closed.</li>
            <li>Google grant: until you disconnect or your account is closed.</li>
            <li>Backups held by our providers: <Todo>Operator: state the provider backup period</Todo></li>
          </ul>
          <p>
            Closing an account is currently done by asking us at <ContactLine brand={brand} />. <Todo>Operator: confirm the deletion process and its timescale</Todo>
          </p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>Depending on where you live, you may have the right to access your personal data, correct it, delete it, receive a copy, object to or restrict some processing, withdraw consent you gave, and complain to your data protection authority. To exercise any of these, contact <ContactLine brand={brand} />. We will verify it is you before acting.</p>
          <p>
            <Todo>Lawyer: confirm the lawful bases, controller and processor roles, and any region-specific statements (for example for the EU, UK or California) that apply to this operator</Todo>
          </p>
        </>
      ),
    },
    {
      id: "security",
      title: "Security",
      body: (
        <p>
          Data is sent over encrypted connections. Access to saved data is restricted by account at the database level. Google grants are encrypted at rest. No system is perfectly secure, so we cannot promise absolute security, and we describe no security certification because none is held. If you find a security problem, please tell us at <ContactLine brand={brand} />.
        </p>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          The service is for working professionals and is not directed at children. <Todo>Lawyer: set the minimum age</Todo>
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: <p>If we change this policy in a way that matters, we will update this page and, for account holders, tell you in the service or by email. Last reviewed: <Todo>date, set when the lawyer approves</Todo></p>,
    },
  ];

  return (
    <LegalDoc
      title="Privacy policy"
      intro={
        <>
          <p>This explains what personal data {brand.name} handles, why, who else handles it, and what choices you have.</p>
          <p>In short: the free generator keeps nothing. If you sign in, we store your account and the signatures you make, and we send content to AI and hosting providers only to do what you asked.</p>
        </>
      }
      sections={sections}
    />
  );
}
