# Media Center

A full-screen app for a Windows PC. It is meant for a TV: big type, a simple menu, and a remote or keyboard.

You can play music, movies, TV shows, and live TV from your own [Emby](https://emby.media) server, plus internet radio. YouTube opens in a separate app if you want it.

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

The home screen is a list: Music, Movies, TV Shows, TV Guide, Radio, YouTube, Pictures, and Settings.

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

Until you sign in, **Music** shows a made-up sample library so you can click around. **Movies** and **TV Shows** wait until Emby is connected.

Other setup, all under **Settings**, and all saved on this PC:

- **Radio** — paste your premium listen key, then choose **Save**
- **Apps** — paste the path to `VacuumTube.exe` if you want YouTube
- **Hub menu**, **Appearance**, and **Playback** — menu order, colors, and how long the on-screen info stays up

## What each menu item does

- **Music, Movies, TV Shows** — your Emby library. Movies and episodes can resume where you stopped.
- **TV Guide** — the channel grid from Emby. Live TV can keep playing behind the menus, and you can watch two channels side by side.
- **Radio** — DI.FM, RadioTunes, JazzRadio, RockRadio, Classical Radio, and ZenRadio. These need a premium listen key from those sites (player settings, then hardware player). One key covers all six.
- **YouTube** — opens the VacuumTube app full screen. Install VacuumTube first, then set its path under **Settings**, then **Apps**.
- **Pictures** — still a “coming soon” screen.
- **Settings** — everything in the list above.

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
