// src/app/(app)/upload/page.tsx
import Link from "next/link";
import Uploader from "@/components/Uploader";

export default function UploadPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Upload</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
      </div>

      <Uploader />

      <section className="mt-12 border-t border-hairline pt-6">
        <p className="eyebrow mb-1 flash-text">READ ME</p>
        <ul className="flex flex-col gap-2.5 text-sm text-haze">
          <li>
            Upload photos will be converted & compressed slightly (94% quality) to save space on storage. You shouldn't even notice. That said, I do have not infinite storage so
            <strong className="text-foam"> please don't go crazy with the videos.</strong> You can see how much space you've used on the 
            <Link href="/browse">gallery page</Link>. So long as everyone stays under 10 GB we should be good.
          </li>
          <li>
            Ideally, this web app will tag the locations of your photos automagically using the metadata.
            This likely <em>won't</em> happen because Apple is a snob about private data they can't sell and strips that shit from any share action.
          </li>
          <li>
            In the likely event your photos are not auto-pinned, you can do so manually on the map page for precision pinning.
            <strong className="text-foam"> Or chose from my pre-selected locations that will show up under the uploads to make it easy.</strong> Or you don't have to pin them at all. its your life.
          </li>
          <li>
            Feedback, bugs and any suggestions you have are welcome. @ me. If this sucks, feel free to make a dropbox or something. It will only hurt my feelings a little bit
          </li>
        </ul>
      </section>
    </main>
  );
}
