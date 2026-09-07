const highlights = [
  {
    title: "18-Hole Parkland Course",
    body: "Rolling terrain, mature trees, and natural water features create a memorable round in the Niagara Region.",
  },
  {
    title: "Pelham Hills Pub",
    body: "Elevated comfort classics, cocktails, course views, and casual service for lunch, dinner, and weekend breakfast.",
  },
  {
    title: "Indoor Golf Year-Round",
    body: "Play iconic virtual courses with modern swing data and comfortable simulator bays through every season.",
  },
];

const quickLinks = [
  { label: "Book a Tee-Time", href: "/booking" },
  { label: "View Memberships", href: "https://www.pelhamhills.com/membership/2026-memberships/" },
  { label: "Reserve Indoor Golf", href: "/simulator" },
  { label: "Contact the Club", href: "#visit" },
];

const hours = [
  { label: "Pro Shop", value: "Daily 6:30 - Dark" },
  { label: "Snack Bar", value: "Monday - Sunday 10:00am - 6:00pm" },
  { label: "PH Indoor Golf", value: "Wednesday - Sunday 2:00pm - 10:00pm" },
  { label: "Monday - Tuesday", value: "Indoor Golf Closed" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f4ed] text-[#182118]">
      <header className="sticky top-0 z-20 border-b border-[#d8d1c3] bg-[#f7f4ed]/92 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a className="font-serif text-xl font-semibold tracking-[0.08em]" href="#">
            Pelham Hills
          </a>
          <div className="hidden items-center gap-7 text-sm font-semibold uppercase tracking-[0.14em] text-[#465444] md:flex">
            <a href="#golf">Golf</a>
            <a href="#pub">Pub</a>
            <a href="#indoor">Indoor</a>
            <a href="#visit">Visit</a>
            <a href="/teesheet">Tee Sheet</a>
            <a href="/admin">Admin</a>
          </div>
          <a
            className="rounded-sm bg-[#214d2f] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#163820]"
            href="/booking"
          >
            Book Now
          </a>
        </nav>
      </header>

      <section className="relative min-h-[calc(100vh-73px)] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/pelham-hills/hero-course.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#10170f]/82 via-[#10170f]/48 to-[#10170f]/18" />
        <div className="relative mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl content-center px-5 py-16 lg:px-8">
          <div className="max-w-3xl text-white">
            <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-[#d6c28f]">
              Established 1966 · Niagara Region
            </p>
            <h1 className="font-serif text-5xl font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">
              Play golf and dine year-round at Pelham Hills.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#f2efe8] sm:text-xl">
              An 18-hole parkland-style course in Welland, Ontario with a welcoming clubhouse,
              scenic views, and indoor golf when the weather turns.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                className="rounded-sm bg-[#d6c28f] px-6 py-3 text-center text-sm font-extrabold uppercase tracking-[0.12em] text-[#182118] transition hover:bg-[#ead7a1]"
                href="/booking"
              >
                Book a Tee-Time
              </a>
              <a
                className="rounded-sm border border-white/70 px-6 py-3 text-center text-sm font-extrabold uppercase tracking-[0.12em] text-white transition hover:bg-white hover:text-[#182118]"
                href="#visit"
              >
                Plan Your Visit
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#d8d1c3] bg-white">
        <div className="mx-auto grid max-w-7xl gap-px bg-[#d8d1c3] md:grid-cols-4">
          {quickLinks.map((link) => (
            <a
              className="bg-white px-5 py-5 text-sm font-extrabold uppercase tracking-[0.12em] text-[#214d2f] transition hover:bg-[#eef1e8]"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="bg-[#214d2f] px-5 py-12 text-white lg:px-8" id="booking">
        <div className="mx-auto grid max-w-7xl items-center gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#d6c28f]">
              Booking Automation
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold">
              Tee-time booking powered by Tee-Sniper.
            </h2>
            <p className="mt-4 max-w-3xl leading-7 text-[#edf4ec]">
              The booking flow is implemented as a Tee-Sniper-style workspace for searching,
              creating wanted tee-time requests, tracking statuses, and reviewing booking attempts.
            </p>
          </div>
          <a
            className="rounded-sm bg-white px-6 py-3 text-center text-sm font-extrabold uppercase tracking-[0.12em] text-[#214d2f]"
            href="/booking"
          >
            Open Booking System
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8a6f30]">The Club</p>
          <h2 className="mt-3 font-serif text-4xl font-semibold text-[#182118]">
            Classic Niagara golf, refreshed for modern play.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {highlights.map((item) => (
            <article className="rounded-sm border border-[#d8d1c3] bg-[#fbfaf6] p-6" key={item.title}>
              <h3 className="font-serif text-2xl font-semibold">{item.title}</h3>
              <p className="mt-4 leading-7 text-[#516050]">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2" id="golf">
        <div
          className="min-h-[420px] bg-cover bg-center"
          style={{ backgroundImage: "url('/pelham-hills/course-detail.png')" }}
        />
        <div className="bg-[#214d2f] px-5 py-16 text-white sm:px-10 lg:px-16">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#d6c28f]">Golf</p>
          <h2 className="mt-3 font-serif text-4xl font-semibold">A scenic round for every player.</h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[#edf4ec]">
            The course balances approachable play with shot-making variety, framed by trees,
            water features, and the relaxed pace of a community club.
          </p>
          <a
            className="mt-8 inline-block rounded-sm bg-white px-5 py-3 text-sm font-extrabold uppercase tracking-[0.12em] text-[#214d2f]"
            href="https://www.pelhamhills.com/golf/rates/"
          >
            See Rates
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 lg:grid-cols-2 lg:px-8" id="pub">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8a6f30]">Pelham Hills Pub</p>
          <h2 className="mt-3 font-serif text-4xl font-semibold">Comfort classics with clubhouse views.</h2>
        </div>
        <p className="text-lg leading-8 text-[#516050]">
          Stop in before or after your round for lunch, dinner, weekend breakfast, handcrafted
          cocktails, and an easygoing clubhouse atmosphere overlooking the course.
        </p>
      </section>

      <section className="bg-[#ebe5d7] px-5 py-20 lg:px-8" id="indoor">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8a6f30]">
              PH Indoor Golf
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold">Rain, snow, or shine, it is golf season.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#516050]">
              Simulator bays make it easy to keep playing, practice with real-time data, and enjoy
              iconic courses without leaving the clubhouse.
            </p>
          </div>
          <a
            className="rounded-sm bg-[#214d2f] px-6 py-4 text-center text-sm font-extrabold uppercase tracking-[0.12em] text-white"
            href="/simulator"
          >
            Reserve a Simulator
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8" id="visit">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#8a6f30]">Visit</p>
          <h2 className="mt-3 font-serif text-4xl font-semibold">196 Webber Road, Welland, ON</h2>
          <p className="mt-5 text-lg leading-8 text-[#516050]">
            Call <a className="font-bold text-[#214d2f]" href="tel:+19057356768">+1 (905) 735-6768</a> or email{" "}
            <a className="font-bold text-[#214d2f]" href="mailto:info@pelhamhills.com">info@pelhamhills.com</a>.
          </p>
        </div>
        <div className="rounded-sm border border-[#d8d1c3] bg-white">
          {hours.map((item) => (
            <div className="grid gap-2 border-b border-[#d8d1c3] p-5 last:border-b-0 sm:grid-cols-[180px_1fr]" key={item.label}>
              <span className="font-bold text-[#182118]">{item.label}</span>
              <span className="text-[#516050]">{item.value}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
