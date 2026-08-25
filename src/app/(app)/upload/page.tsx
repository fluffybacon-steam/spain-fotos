// src/app/(app)/upload/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import Uploader from "@/components/Uploader";

export default async function UploadPage() {
  // Middleware already turns guests away from /upload; this is the second lock,
  // the same way the app layout backs up the auth check.
  const me = await currentUser();
  if (me?.role === "guest") redirect("/");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <div className="mb-7 flex items-start justify-end gap-4">
        <div style={{marginRight: "auto"}}>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Upload</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
        <Link href="/browse" className="btn btn-quiet btn-sm sm:hidden">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M360-400h400L622-580l-92 120-62-80-108 140Zm-40 160q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-720v480-480Z"/></svg>
        </Link>
      </div>

      <Uploader />

      <section className="mt-12 border-t border-hairline pt-6">
        <p className="eyebrow mb-1 flash-text">READ ME</p>
        <ul className="flex flex-col gap-2.5 text-sm text-haze">
          <li>
            <strong className="text-foam">Bad news iPhone users</strong>. Ideally, this web app would tag the locations of your photos automagically using the metadata.
            But because Apple is a snob about privacy, they strips that shit from any website that asks for photo shares.
          </li>
          <li style={{fontSize: '1.5rem'}}>
            You can test your images metadata <Link className="underline text-foam" href='/debug'>here</Link> before uploading
          </li>
          <li style={{fontSize: '1.75rem'}}>
            If this is too much, remember you can always just upload directly from your phone and be done with it!
          </li>
          <li>
            In the likely event your photos are not auto-pinned, you can do so manually on the map page for precision pinning.
            <strong className="text-foam"> Or chose from my pre-selected locations that will show up under the uploads to make it easy.</strong> Or you don't have to pin them at all. its your life.
          </li>
          <li>
            <strong className="text-foam">One way to circumvent iOS privacy setting is to upload your photos from a desktop/laptop.</strong> This would involve going into Google Photos or iCloud Photos, download your trips photo to the computer and then upload to the website. Completely circumventing the iPhone's privacy os bullshit.
          </li>
          <li>
            Upload photos will be converted & compressed slightly (94% quality) to save space on storage. You shouldn't even notice. That said, I do have not infinite storage so
            <strong className="text-foam"> please don't go crazy with the videos.</strong> You can see how much space you've used on the 
            <Link href="/browse">gallery page</Link>. So long as everyone stays under 10 GB we should be good.
          </li>
          <li>
            Feedback, bugs and any suggestions you have are welcome. @ me. If this sucks, feel free to make a dropbox or something. It will only hurt my feelings a little bit
          </li>
        </ul>
      </section>
    </main>
  );
}
