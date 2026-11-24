# Media Center

A full-screen app for a Windows PC inspired by the Zune HD. It is meant for a TV: big type, a simple menu, and a remote or keyboard.

You can play music, movies, TV shows, home videos, and live TV from your own [Emby](https://emby.media) server, look through your photos, and play internet radio. YouTube opens in a separate app if you want it.

## What you need

- Windows
- Microsoft Edge (it is already on Windows 10 and 11)
- Python 3, which is free
- An Emby server, if you want your own movies, shows, music, or live TV

The app does not install extra Python packages. Python itself is the only thing to add.

## Install

### 1. Download the app

On this GitHub page, click the green **Code** button, then **Download ZIP**.

Unzip the file and put the folder somewhere you will leave it, such as `C:\Media Center`. The app runs from that folder. Keep it.

### 2. Install Python

Skip this step if Python is already installed.

1. Open [python.org/downloads](https://www.python.org/downloads/) and download Python 3.
2. Run the installer.
3. On the first screen, turn on **Add python.exe to PATH**.
4. Click **Install Now**.

### 3. Start it

Open the unzipped folder and double-click **Start Media Center.bat**.

That starts a small window called **Media Center helper**. Leave it running while you use the app. You can minimize it. Edge then opens full screen, with no address bar.

The first time, Windows may ask if Python is allowed to use the network. Allow it on private networks. The helper only talks to this PC.

To close the app, press **Alt+F4**. Then you can close the helper window.

Open the app with the bat file. Opening `index.html` by itself skips the helper, and YouTube and a few other pieces will not work.

## First time you open it

The home screen is a list: Music, Movies, TV Shows, Home Videos, TV Guide, Recordings, Radio, YouTube, Pictures, and Settings.

- **Arrow keys** move
- **Enter** selects
- **Escape** or **Backspace** goes back
- **Space** pauses or plays

To use your own library:

1. Open **Settings**
2. Stay on **Emby server**
3. Type the server address, your username, and your password
   - The address looks like `192.168.1.20:8096`, or whatever you already type in a browser to open Emby
4. Choose **Connect**

Your password is typed in only to sign in. The app does not save the password. It remembers the sign-in on this PC, in a `browser-data` folder that it creates next to the bat file. That folder stays on your computer. It is not part of this download.

Until you sign in, **Music** shows a made-up sample library so you can click around, and **TV Guide** shows sample channels. **Movies**, **TV Shows**, **Home Videos**, **Recordings**, and **Pictures** wait until Emby is connected.

Other setup, all under **Settings**, and all saved on this PC:

- **Radio** — paste your premium listen key, then choose **Save**
- **YouTube** — a YouTube key, if you want videos to play inside this app
- **Apps** — the path to `VacuumTube.exe`, if you still want YouTube to open in that separate app
- **Hub menu**, **Appearance**, and **Playback** — menu order, colors, and how long the on-screen info stays up

## What each menu item does

- **Music, Movies, TV Shows** — your Emby library. Movies and episodes can resume where you stopped.
- **Home Videos** — home movies and other videos you keep in an Emby “home videos” library. You can browse by folder, see everything, or see the newest ones. A video you already started can resume.
- **TV Guide** — the channel grid from Emby. Before you sign in, it shows sample channels so you can try the screen. Open a show and you can watch it, record that airing, or record the series. Live TV can keep playing behind the menus. On the player, the **pip** button adds more channels: one big picture and up to three small ones, or two side by side. Pick which look under **Settings**, then **Playback**. The **captions** button turns closed captions on or off for live TV, and that choice is remembered. Arrows move between the pictures (you hear the one with the frame). Enter swaps a small picture into the big spot, or returns to one full-screen channel. Back closes the framed picture.
- **Recordings** — what Emby’s DVR has recorded, plus what is set to record. Sections are **Recent**, **Shows**, **Movies**, **Scheduled**, and **Series**. Your Emby user needs permission to manage live TV recordings. If a button says it is not allowed, that permission is under Emby’s dashboard, then Users, then your account.
- **Radio** — DI.FM, RadioTunes, JazzRadio, RockRadio, Classical Radio, and ZenRadio. These need a premium listen key from those sites (player settings, then hardware player). One key covers all six.
- **YouTube** — with no extra setup, this still opens the VacuumTube app. Add a YouTube key under **Settings**, then **YouTube**, and videos play inside the media center with the same controls as movies. **Premium** opens YouTube’s own page once, so a Premium account plays without ads. **Sign in** adds your subscriptions, playlists, and liked videos. That needs a client id and secret from the same Google project as the key: Credentials, then Create credentials, then OAuth client id, type “TVs and Limited Input devices.” On the OAuth consent screen, set the app to “In production,” or Google asks you to sign in again every week. The key and the sign-in stay on this PC. They are not part of the download. Under **Menu** on that same settings page, you can switch YouTube back to VacuumTube.
- **Pictures** — photos from an Emby library named Photos or Pictures, or from a combined home-videos-and-photos library. **Folders** follows your folders. **All** shows every photo. **Recent** shows the newest ones. Enter on a photo fills the screen. Left and right move between photos. Enter starts a slideshow, about 7 seconds each. Up shows the name and date.
- **Settings** — everything in the list above.

On **Settings**, then **Hub menu**, the instructions sit to the right of the list: left and right move an item up or down, Enter shows or hides it, and Settings always stays last. New items, such as Home Videos, are added to the home menu as shown. Hide one there if you do not want it.

## What's new

- **TV Guide** has tabs: **guide · movies · shows · sports**. **Movies** lists every movie on your channels in the next two weeks, **shows** and **sports** what's on this week. Press left at the left edge to sort (for movies: by year, air date or title) or switch between posters and a list. Enter opens the details with watch and record. A red dot means it's already set to record. The guide's info line now shows the title and time only (the description is on the show's page), which keeps six channels on screen.
- **Movies** and **TV Shows** have four more layouts in the hidden side menu (press left at the left edge): **showcase** (the backdrop fills the screen, with the story above one row of posters), **wall** (wide scene pictures), **list + details** (titles on the left, poster and story on the right), and **carousel** (one big poster in the middle). Movies and TV Shows each remember their own choice.
- **Radio** has the same hidden side menu: covers or list, three sizes, and the network's order or A to Z.
- **Settings**, then **Channels**: hide channels you never watch, and mark favorites so they sit at the top of the guide. Also on that page: show or hide channel numbers, show 2, 3 or 4 hours of the guide at a time, and open the guide on the last channel you watched.
- **Settings**, then **Appearance**: large text, a 24-hour or hidden clock, and which screen the app opens on (the home menu, any menu item, or straight to the last channel you watched).
- **Settings**, then **Playback**: how far left and right jump in movies and shows, whether the next episode plays by itself (with a short countdown), and a sleep timer that stops everything after 15 minutes to 2 hours.
- Live TV captions stay in reading order when a caption is more than one line.
- **Settings**, then **YouTube**, and **Settings**, then **Apps**, are one list with headings instead of two columns.
- **Recordings** is on the home menu. From a show in the TV guide you can record that airing or the series.
- **YouTube** can play inside the media center after you add a key under **Settings**, then **YouTube**. VacuumTube is still there if you prefer it.
- The Emby app on a phone can control this screen: play, pause, and move around, the same as the remote.
- Live TV can show up to four channels at once: one big picture and three small ones. **Settings**, then **Playback**, can switch that to two channels side by side.
- Live TV has a **captions** button. On or off is remembered.
- If a movie or episode will not play as it is, the app asks Emby to convert it and continues from the same spot.
- **Pictures** is a photo browser, with folders and a full-screen slideshow.
- **Home Videos** is on the home menu for videos you keep outside Movies and TV Shows.
- **TV Guide** can be opened before you sign in. It uses sample channels until Emby is connected.

While something is playing, go back to the home menu and press **Back** again. That jumps to the full-screen player.

Movies and episodes play inside the app. When a file is in a form Edge cannot play directly, your Emby server converts it while you watch, so that work happens on the Emby computer. Sound comes through as stereo or 5.1. On-screen subtitles are not shown yet. Song lyrics can show on the music player when Emby has them.

## Start it when Windows starts

This part is optional.

1. Press **Win+R**
2. Type `shell:startup` and press Enter
3. Put a shortcut to **Start Media Center.bat** in the folder that opens

## If you download a newer copy later

Unzip the new files over the same folder. Leave the `browser-data` folder where it is. That is where your sign-in, colors, and radio key live. Deleting that folder makes the app forget them.

If the app is already open, close it before you replace the files.

## If it does not start

- A message says Python was not found. Install Python again and turn on **Add python.exe to PATH**, then double-click the bat file.
- Edge never opens. Install Microsoft Edge, then try again.
- Nothing opens, or it complains that the address is already in use. Another copy is already running. Close the **Media Center helper** window (and any older media-center window) and try again. Only one copy can run at a time.
- Movies, shows, or live TV are empty. Open **Settings**, then **Emby server**, and sign in. This PC has to be able to reach that server, the same way your browser can.
- Radio will not play. Add the listen key under **Settings**, then **Radio**.
- YouTube says it could not open. Start the app with **Start Media Center.bat**, and set the VacuumTube path under **Settings**, then **Apps**.

## Voice control

This is optional. The app can follow voice commands from a separate assistant program. The media center does not use the microphone itself. If you do not have that assistant, skip this. The keyboard and a remote are enough.

If you do have it, open **Settings**, then **Apps**, and enter the folder that contains `app.py`. Save it. From then on, **Start Media Center** also starts the assistant.
