<script lang="ts">
  import '$lib/styles/landing.css';
  import { locale } from 'svelte-i18n';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  const entries = [
    {
      date: 'August 27, 2026',
      title: 'Tools work on every message, not just the first',
      items: [
        'The homepage now shows the two ways to use Anomalia side by side — ready-to-go cloud or self-hosted on your own server — with mobile and desktop apps marked as coming soon.',
        'Sending a second message in a chat no longer makes every tool refuse with “turn closed by the system”: the agent keeps working for the whole conversation.',
        'Self-hosting: the production build now reads your .env on start, the database is reachable on whatever port you set, and a fresh install boots instead of stopping on an empty ORIGIN.',
        'Self-hosting: usage and cost are recorded again on a fresh install — eight columns the app writes were missing from the database. Run the migrations once more to get them.',
        'Self-hosting: radar, post revisions, article translation and chat reasoning work on a fresh install — the tables and columns behind them were missing from the migrations.'
      ]
    },
    {
      date: 'August 26, 2026',
      title: 'Your agent has a real desktop',
      items: [
        'Reopening a chat while an answer is still being written no longer shows scrambled text: the reply picks up exactly where it was.',
        'When you watch your agent’s computer, you now see it browse: pages open on the screen instead of somewhere you cannot see.',
        'Work an agent hands to a helper now happens on that agent’s own computer, the one the panel shows you.',
        'Self-hosting now works end to end from an empty database: bring the stack up, run one command, and you can sign in — schema, background jobs and login all verified on a clean install.',
        'The model you pick for a chat now sticks to that chat, on every device — reopen it tomorrow on your phone and it answers on the same model.',
        'Each of your custom agents can now be set to a specific model, and it uses that model on its scheduled runs too.',
        'Motion videos asked for in chat are now built by the same engine as the Motion video studio, so they get the full craft — real transitions, easing, reference structure — instead of a first draft.',
        'Chats in the sidebar now show a steady green dot on every agent that is still working, right when you open the app — no need to open each conversation.',
        'Agents can now see what their teammates have been working on and which teammate conversations are waiting on them, so handovers happen instead of duplicated work.',
        'Agents can no longer overwrite work they have not seen: editing a post, document, graphic or motion source requires reading it first, and if it changed in the meantime the agent is asked to re-read and try again.',
        'Pricing cards no longer show a leftover “credits included” line under the price. Free now shows the real credit amount instead of a broken placeholder.',
        'Your agent’s computer is now a full Ubuntu desktop — panel, app menu, dock, file manager, browser — instead of a blank screen.',
        'Click Take control in the agent panel and the desktop opens full screen, with mouse and keyboard on the same windows the agent is using.',
        'Copy and paste now works both ways between that desktop and your own device, from the buttons under the screen.',
        'On a phone, a Keyboard button brings up your keyboard and types into the desktop.',
        'The desktop no longer shuts down under you after a few minutes: it stays up while you are on the page.',
        'Signing in to a site by hand now stays on that machine, so the agent can keep working there without ever seeing your password.',
        'Your agent now works on one machine instead of three, so what you see in the panel is the machine it is actually using.',
        'The desktop now starts in seconds instead of minutes, and turns on reliably — it used to fail to install altogether.',
        'Asking an agent to render a motion video works again — renders were failing on a missing piece of the rendering machine, and the error came back as a closed VM.'
      ]
    },
    {
      date: 'August 26, 2026',
      title: 'Optional repo skills for agents',
      items: [
        'Agent runs can now load the repository’s markdown skill packs on demand, opt-in via the HARNESS_SKILLS setting (off by default).'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'Agents can delegate again',
      items: [
        'Specialist agents in the new engine can now hand sub-tasks to helper agents (research, execution, verification) — the same delegation that already worked in standard chat, with no helpers spawning further helpers.'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'Motion, edited in place',
      items: [
        'Motion compositions can now be edited with targeted search-and-replace instead of full rewrites.'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'Agent faces move again',
      items: [
        'The sidebar now has a proper edge, and its top row lines up with the page header above the content.',
        'Reload the page mid-answer and the work an agent has already done is there waiting, instead of a thread that looks like it was wiped.',
        'Switching to another tab no longer freezes a running answer: come back and it has kept going.',
        'The status line and its timer now sit at the bottom of a running answer, under the tool steps too, with the agent face beside them for the whole turn.',
        'Tool steps in a running answer now keep what they were called with and what they returned, so opening one tells you something.',
        'Stop now works after a page reload: it used to look like a button and do nothing, leaving the turn running and your next message stuck in the queue.',
        '"Send now" on a queued message works after a reload too, for the same reason.',
        'A reply no longer shifts around when it finishes: the agent face, the spacing and the action row stay where they were, so the chat does not jump.',
        'The New messages line now only shows up for replies you actually missed — not for one that just came in while you were reading, and not after a refresh.',
        'Agent avatars now morph between expressions instead of switching instantly.'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'Self-hosting, for real',
      items: [
        'Self-hosted instances can now run a real production build — start the app from Docker Compose or a Node server instead of the dev server.',
        'A built-in scheduler container now runs all background jobs on self-hosted instances, no external cron setup needed.',
        'Instances without social publishing connected now skip posting with a clear reason instead of failing.',
        'Support email, sender domain, app URL and crawler identity are now configurable through environment variables.'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'Smoother start for every workspace',
      items: [
        'Creating a workspace no longer fails when your brand name uses a non-Latin alphabet — the web address is picked automatically if it is already taken.'
      ]
    },
    {
      date: 'August 25, 2026',
      title: 'One engine under the hood',
      items: [
        'Specialist agents now run on a single, shared engine — same behaviour in chat, far less machinery to keep alive.',
        'If the AI provider is not configured, an agent turn now fails fast with a clear error instead of silently falling back.'
      ]
    },
    {
      date: 'August 24, 2026',
      title: 'Nothing lost on a refresh',
      items: [
        'A correction sent while an agent is working now changes the answer it is still writing, not the next one.',
        'Write to a specialist agent while it is working and it now hears you within the same turn, instead of holding your message until the turn is over.',
        'Reload the page while an agent is working and you now get a way to stop that turn, instead of a line of text counting the minutes.',
        '/goal now works with specialist agents: they break the goal down, tick each criterion off as it becomes true, and pick the work back up on their own until it is done.',
        'A specialist that says a job is finished is still checked against what it actually did — having a goal open no longer switches that check off.',
        'Ask and Plan mode now hold on specialist agents too: in Ask a specialist can only read, and can no longer create, approve or schedule anything.',

        'Specialists can now hand work to each other: the agent who finishes a video can ask the web specialist for the article that goes with it, without you relaying it.',
        'Ask an agent to change "the motion video from the 4th" and it now knows which one you mean — the list of videos carries their dates, and where to open the code behind each one.',
        'A tool that keeps failing now disappears from the agent’s toolbox for a moment, with a note saying why — instead of the agent retrying it and burning the turn.',
        'Specialist agents now end their turn the moment they answer you or ask you something, instead of sometimes talking past their own question.',
        'A message sent while the assistant is still working is now heard exactly once — it no longer repeats itself into the rest of the turn.',
        'Motion videos built from a studied reference no longer re-attach the reference frames at every step of the work.',
        'A message sent while the agent is still working now counts exactly once: it no longer risks being applied twice in the same turn.',
        'A specialist agent whose turn dies now frees the chat in seconds instead of minutes — no more waiting on a "working" bar with nothing behind it.',
        'A long background turn no longer shows a false error banner while it is still working.',
        'The Analyst specialist can now actually do its job: read your strategy, posts, leads and history — and run the analytics review — instead of having no tools at all.',
        'The Content Creator can now edit a post you already have: change the caption, move it to another time, or add a platform, without recreating it from scratch.',
        'The Motion specialist can now add a voice-over and a music bed to a video it makes, instead of only ever producing a silent one.',
        'Specialist agents no longer waste a step opening files that were never there: every document their briefing points them to now exists.',
        'Specialist agents now search your uploaded documents and notes by meaning, not just by exact words — so an answer that only exists in a file you uploaded is found and quoted.',
        'Specialist agents can now read your strategy, editorial plan and GTM roadmap as one document, instead of piecing it together table by table.',
        'Stop now really stops a specialist mid-task: the work halts, nothing new is charged, and no answer shows up afterwards.',
        'Whatever a specialist had already done before Stop or an interruption stays in the chat, tool steps included, so a resumed task carries on instead of starting over.',
        'A specialist that runs commands on its machine no longer reaches the open internet, so nothing about your brand can leave that way.',

        'An agent whose action fails twice in a row the same way now changes approach or says what is missing, instead of retrying the same thing over and over.',
        'Work interrupted mid-task is no longer redone from scratch: the assistant now remembers the interrupted step and checks what already happened before spending credits or posting again.',
        'A reply can no longer show up twice in chat when a turn is recovered after a crash or timeout.',
        'A specialist turn that was already declared dead now also stops working in the background, instead of quietly burning through resources.',
        'Deleting a queued message now really deletes it — before, it silently stayed and could still run later.',
        '"Send now" on a queued message sends it once and removes it from the queue, instead of duplicating it.',
        'The chat no longer stays stuck busy after a turn has finished: new messages send right away instead of piling up in the queue.',
        'An agent that catches itself about to repeat the same answer without doing new work now corrects course or asks what is missing, instead of looping forever.',
        'Asking for a post on a platform you have not connected now gets an immediate answer instead of a made-to-order post nobody can publish — the assistant tells you to connect it first, and can still prepare a draft if you ask.',
        'Approving a post with no connected account for its platform now says plainly that it is approved but will not go out yet, instead of reading like it was scheduled.',
        'A long turn that runs out of steps now ends with one answer instead of two messages in a row.',
        'Specialists no longer waste a step opening brand files that were never there — they go straight to the tool that has the data.',
        'An article the assistant actually wrote is no longer mistaken for an empty promise and redone from scratch.',
        'The Analyst now sees everything your brand has actually published — posts from your connected accounts count too, so it no longer reports "nothing published" when there is.',
        'Asking an agent about performance no longer wastes a step on a dead end: the published history is a file it can open directly, with the real numbers.',
        'A specialist agent that runs out of time on a long task now picks up where it left off automatically, instead of stopping halfway and waiting for you to ask again.',
        'Ask any specialist who else is on the team and you get a straight answer: every colleague, what each one does, who they usually hand work to, and how they write to each other.',
        'Every specialist can also tell you what it will never do — pay for anything, log in as you, or delete another specialist — instead of quietly working around it.',
        'Ask an agent to check with two colleagues at once and it now writes to both in one go — but only when you ask: agents no longer decide on their own to message the whole team.',
        'The assistant no longer repeats itself while working — its working notes now collapse under "Thought for a moment" instead of showing up as separate messages.',
        'An honest "nothing to report" no longer gets mistaken for a finished job and re-triggered — and a real unfinished promise is now caught reliably, in Italian and English.',
        'A long reply now keeps running on our side even if you close the tab or lose your connection halfway — it used to be cut off and never saved.',
        'Work an agent had already written before being interrupted now reliably lands in the chat, instead of the turn simply disappearing.',
        'A follow-up you queued while an agent is working now starts as soon as that agent finishes, instead of waiting for the next sweep.',
        'Sending images while a reply is still in progress no longer sends them silently without the images: the message stays in the box so you can send it when the chat is free.',
        'The live progress of an ongoing agent stays visible after you queue a follow-up, instead of being replaced by an empty spinner.',
        'Answering an agent’s question hours later no longer risks the reply being cut short.',
        'A queued message is no longer posted twice when it arrives just as another reply starts.',
        'Open chats are lighter on battery and data: the page stops checking for updates when it is in the background.',
        'Chats with a specialist now appear in your usage and count against your credits — those turns were running off the books.',
        'Sending the same message again while the agent is still working no longer starts two competing replies — the new message waits its turn.',
        'Refresh the page while an agent is working and the live progress now picks right back up, instead of freezing on a spinner that never ends.',
        'If your connection drops mid-reply, the reply keeps going on our side and the page catches back up on its own — no more error bar over work that was still happening.',
        'A reply stuck on a dead connection now frees itself after a moment instead of staying frozen until you reload.',
        'A message that fails to reach us — say your wifi drops as you hit send — is no longer shown as sent: the error stays on screen with a working Retry button until you act on it.',
        'A follow-up queued behind a busy reply that never reaches us now goes back into the box and says so, instead of vanishing.',
        'Opening a chat with a pre-filled message now survives a refresh at the wrong moment — the message is delivered once, not lost and not duplicated.',
        'Sending a message while an agent is still working after a page reload now queues it instead of starting a second, competing reply.',
        'Text you typed but had not sent yet now survives a page refresh — it is right there in the box when the page comes back.',
      ],
    },
    {
      date: 'August 23, 2026',
      title: 'Agents can find what they were given',
      items: [
        'Reload a page mid-turn and the reply keeps streaming in — it used to just say "still working" until you refreshed again.',
        'The Content Creator, UGC Specialist and Web Specialist can now actually create posts, graphics, AI photos, videos and blog articles — not just analyze what already exists.',
        'The agent panel now shows a live view of the agent’s screen, updating as it works.',
        'Agents can now open a real desktop — taking screenshots and clicking, typing or scrolling to get things done.',
        'The Motion specialist now renders the actual video in chat, with a real preview link, instead of just describing what it would look like.',
        'When an agent thinks more than once while replying, each stretch of thinking now shows up where it actually happened — instead of every bit of thinking glued into one row above the whole answer.',
        'Thinking is now a quiet, clickable row instead of appearing in full above the answer.',
        'Replies now say what exists, with its id and where it sits, then stop — no preamble about what the agent is about to do, no walkthrough of how it did it, and no closing “shall I proceed?”. Anything that failed is still explained in full.',
        'Agents can now read your data straight from the database when no existing tool covers the question — with your own permissions and read-only, so they see exactly what you would see in the app and nothing belonging to anyone else.',
        'A single reply now stops once it has burned through its token budget, and says so, instead of running up an unbounded bill \u2014 everything it finished is saved, and you pick which part to carry on.',
        'Agents now carry about a fifth less standing instruction in every step, so a conversation stays useful for longer before it has to be trimmed.',
        'Your agents no longer carry your whole brand Studio \u2014 voice, palette, products, people, competitors \u2014 into every step of every reply; they look it up when the job actually needs it, and the general assistant, the makers and the specialists all read the same one.',
        'The general assistant now reads the video-making guide before it writes a video, the way the Motion specialist already did, instead of carrying the whole manual everywhere.',
        'The playbook for pitching an idea that is not the safe default is now something an agent opens before proposing angles, campaigns or scripts \u2014 your brand\u2019s saved ideas still sit in front of it at all times.',
        'Long video renders no longer get cut off partway through on brands that had made one before.',
        'The check that stops a voice-over from being cut off mid-sentence now measures the video that actually comes out — on most compositions it had been measuring a six-second one however long the real video was, so a line could get clipped with nothing noticing.',
        'Agents can now look up a file by its name across everything they hold, instead of opening folders one at a time.',
        'Searching now takes about a second instead of twenty.',
        'A search now brings back results from every file that contains them, instead of a dozen lines from the first one.',
        'A search now says how many files it actually looked in, and names the ones it could not open — it no longer claims to have read them all.',
        'Searching somewhere an agent does not cover now says exactly that, instead of an error the agent reads as “that does not exist”.',
        'Searching now finds an Italian word however the accent was typed, and finds it without the accent too.',
        'Agents can read a long file a page at a time, and are told where they stopped and how to carry on.',
        'A long list can now be filtered and its limit raised, instead of showing the first sixty with no way to reach the rest.',
        'Skimming the video-making guide no longer counts as having read it: an agent still has to read it in full before it writes a video.',
        'When an agent counts something for you, a metric that simply is not collected for your account now reads as missing instead of quietly counting as zero \u2014 so a report can no longer show a median of 0 as if it were a real number.',
        'Your posts and your strategy are now actually on hand when an agent runs the numbers: both had been failing to load, and the agent was told the data did not exist.',
        'Agents no longer double-count a post that was picked up twice from two different sources.',
        'Time an agent spends on its own machine is now billed to your account like everything else, including runs that fail \u2014 the machine ran either way.',
        'Specialists get their brand context back: the Content Creator can see your media library, editorial plan and scheduled posts again, and the Analyst can see your strategy, roadmap, competitors and leads \u2014 all of it had silently stopped reaching them two days ago.',
        'Agents no longer promise you something they cannot do \u2014 every tool named in their instructions is now one they actually hold.',
        'The Web Specialist can now show you the covers and images it makes, instead of pasting a link you cannot watch \u2014 and a finished video is handed over the same way.',
        'Any specialist can now write a large request out as a plan document, which until now only the general assistant could do even though all of them were told to.',
        'A file you attach is now saveable into your brand knowledge whichever specialist you are talking to, not only the Content Creator.',
        'The Analyst can correct the competitor list it works from, and the Content Creator can rename, refile or delete a document and manage the three style references that steer every generated image.',
        'Specialists now know they have their own machine for anything that has to be counted or computed, instead of only being told to ask a helper for one.',
        'Asking an agent to score a finished video in chat now gets you its own read of the clip instead of a scoring step that kept failing \u2014 the stored score on a post is still shown, and the media reviewer page still writes new ones.',
        'Your specialists can now browse and search every guide and reference they have been given, not just the handful named in their index \u2014 the motion agent went from seeing one file to all 153, including the full animation documentation it builds videos from.',
        'Listing a folder that exists no longer comes back empty, and searching inside one no longer comes back as an error.',
        'Opening a folder now shows what is directly inside it \u2014 each subfolder with how many files it holds \u2014 instead of dumping seventy-four files at once, and the agent can ask for the whole subtree when it actually wants it.',
        'Live SEO and keyword research now belongs to the Web Specialist alone \u2014 the other specialists ask it for the numbers instead of carrying the whole research kit into every step.'
      ]
    },
    {
      date: 'August 22, 2026',
      title: 'Your agents, working together',
      items: [
        'Type /clear in a chat to give the agent a clean slate \u2014 it starts fresh from that point, while every message you have exchanged stays in the conversation.',
        'When a goal closes on its own, the note now says the system closed it \u2014 not the agent \u2014 and how many steps were ticked off from the reply text rather than by a tool that ran.',
        'Closing a goal now asks for what exists that did not exist before, with ids, or why it cannot be done \u2014 repeating the checklist back no longer counts.',
        'Ticking off a goal step is now refused when nothing backs it: the agent is told which step, what is missing, and that it can either do the work or declare the step impossible with a reason \u2014 instead of quietly marking it done.',
        'A step can no longer be ticked off in the same turn where the tool doing the work was refused \u2014 it reopens instead, saying which tool did not go through.',
        'While a goal is open, a turn that only read things now says so, however it describes itself \u2014 \u201cI created it\u201d and \u201cI patched it\u201d cannot stand on a turn that wrote nothing.',
        'Saving a video composition no longer reports success with a link to the gallery before the video is rendered \u2014 it says plainly that there is nothing to watch yet and what the next step is.',
        'When a step asks the agent to look and call it again, it is no longer reported as a failure \u2014 so the agent retries instead of giving up and calling the job done.',
        'A reply now names any action that did not go through, so \u201cit is ready\u201d and \u201cit was refused\u201d can no longer sit in the same message unnoticed.',
        'The actions row now says how many did not complete, instead of only how many were taken.',
        'A goal step now closes on what happened, not on the agent saying it happened: a tool that failed no longer counts as work, a turn that only read things cannot tick anything off, and a step that names the tool it needs stays open until that tool has actually run.',
        'An agent can no longer hand you a file it did not make \u2014 when a reply runs no tool at all, it says so, and any link in it is an older file.',
        'When background work fails to start, the chat now tells you nothing is running instead of leaving you waiting.',
        'A screenshot of an interface can no longer sit frozen behind a video with things floating on top of it \u2014 the check is on by default, and it asks for the product to be rebuilt and moved instead.',
        'The animation patterns your agents copy from now ship with the video each one produces, and are grouped by the question you are asking \u2014 how one scene becomes the next, how a line of copy arrives, and how a post you already approved turns into motion.',
        'A carousel you approved can become a video in five presentations: a flat stack, a 3D coverflow, a rolodex, a triptych, and a receding corridor.',
        'A wall of your published posts can scroll as a seamless loop, ending on exactly the frame it started on.',
        'Text arrives four new ways: typed at a real rhythm instead of a metronome, one word at a time, line by line from behind a mask, or with a single word snapping into focus.',
        'A video can no longer end on seconds of black \u2014 its length is checked against the scenes that actually fill it, and a mismatch is refused before it is rendered.',
        'A transition written the wrong way used to pass every check and then kill the render; it is now stopped as the code is written, with the line that fixes it.',
        'Graphics built from real type are now checked the moment they are made, not only when an agent edits them afterwards \u2014 and a first attempt with unreadable or off-canvas text is fixed once automatically before you ever see it.',
        'The agent that writes a graphic now works to the same measured rules the rest of the product follows: minimum type size, page margin, line length, colour count, and the brand logo when you have one.',
        'A post with no image or video can no longer be approved, scheduled or published \u2014 it is stopped with a plain explanation instead of going out empty.',
        'Graphics are slower to fail and quicker to recover: a stuck request now gives up in two minutes instead of hanging, and a brief hiccup is retried once instead of losing the whole composition.',
        'Every graphic keeps its editable source, so \u201cmake the headline shorter\u201d stays an edit instead of a fresh start \u2014 and a save that only half works now says so instead of pretending.',
        'The 0\u201310 score on your posts is paused. It was judging still images by a checklist written for video, so almost everything came back as a fail; your past scores are all still there, and you can still ask for a review whenever you want one.',
        'Image quality checks now record how many attempts a picture actually took, and say when the limit was reached rather than presenting the last try as the best one.',
        'Agents that build motion videos now open the craft guide as a file and are refused until they have read it, instead of carrying it in their head every turn — so a turn that is not about video no longer pays for it, and one that is cannot skip it.',
        'The craft your agents follow — the motion recipes, the animation library and the full Remotion documentation — is now a folder you can open and correct, and your edits win over ours without waiting for a release.',
        'Keys and passwords are now stripped from an agent\u2019s saved working log before it is written down, and a log is only visible to the person whose conversation it came from.',
        'The reference material your agents read is now visible to you as files, and the ones you have edited yourself always win over ours.',
        'When an agent hands a job to a helper, it can now open the helper\u2019s full working log instead of taking its word for it — so a job that went wrong can be diagnosed rather than redone.',
        'Every new motion video now starts as real scenes instead of one long timeline, so a scene can be rewritten, moved or made longer without breaking the ones around it.',
        'A scene whose animation is already over by the time it appears on screen — the reason some videos looked frozen at the cut — is now caught and fixed before the video is finished.',
        'Kinetic titles now bring words in one after another at a pace worked out from the words themselves, and the video is lengthened rather than the words rushed.',
        'A motion video that is not good enough yet is picked back up on its own until it is — and the agent stops and tells you when two rounds in a row stop improving it, or when it has spent as much on one video as a video is worth.',
        'A scene that freezes on screen is now caught before the video is made, on every video — the check used to miss the way most of them are written.',
        'A motion video that would come out silent is flagged before it is rendered, instead of after you watch it.',
        'The thinking level you pick now really changes how hard the agent thinks — Auto and Pro no longer reason at the same depth.',
        'Agents stop re-reading the same brand data twice in one turn, so a turn finishes in about half the time.',
        'A graphic can no longer be saved with type too small to read in the feed — the size is checked against the canvas first.',
        'When a graphic uses a colour that is not in your brand palette, or type sizes that all look alike, the agent is told before you have to spot it.',
        'Before a motion video is rendered, the agent draws a storyboard of it — one picture per scene — looks at each one, and fixes what does not work before spending the render.',
        'Motion videos in chat are now checked frame by frame while they are being built, instead of only after the finished file exists.',
        'The agents that build motion videos now carry the full library of transition recipes, so the moves the quality check asks for are ones they have actually been shown.',
        'Agents that build motion videos now look up the current documentation of the animation library before using something they are unsure of, instead of writing it from memory.',
        'Agents get on with the work instead of asking whether they should, or which of two ways you prefer — they only stop for something that only you can answer.',
        'A goal now only lists what you actually asked for: an agent no longer turns its own working habits into tasks you have to wait on.',
        'Work an agent describes as finished now actually ticks the task off, and a run that ticks nothing gets one informed retry before the goal comes back to you.',
        'A goal now says which tasks were ticked off in that very run, not just how many are done in total.',
        'A goal in a chat now says how many tasks are left; open it and you see every task, which ones are done, and why a run stopped.',
        'On a phone, the menu button inside a panel — or in Settings — now opens the list of sections for that panel, with a way back to the team at the top.',
        'The Status button in the top bar is now called Overview, and Overview opens from the Spaces panel too, at the top of the list.',
        'Every brand now gets every recurring job on schedule: the ones at the back of the queue go first, so nobody is skipped week after week.',
        'Each job on your team page now shows when it last reached your brand, and flags the ones that are running late.',
        'The homepage now shows the team at work instead of explaining it in five steps.',
        'Blog opens again for brands that already have articles — the page used to sit on a loading skeleton forever.',
        'A panel that fails to load now says so and offers a way out, instead of pulsing forever with no message.',
        'When an agent needs an app you have not connected, it now asks you to connect it right there instead of saying it cannot help — any app in the catalogue, at any moment, not just during setup.',
        'What your agents learn in a chat now becomes part of what your brand knows: a fact you confirm more than once stops living inside that one conversation.',
        'Brand knowledge is tidied up every night — what nobody uses fades out, and nothing is deleted before it has been shown to an agent at least once.',
        'While an agent is working, its avatar has a life of its own: it changes expression at its own pace and, every so often, pulls a full spin.',
        'The avatar no longer freezes into a blank face while it works — expressions morph the way they were meant to.',
        'Rows like 3 actions taken stay in the middle of the chat while the answer is still coming in, and the answer itself no longer shifts sideways when it finishes.',
        'Each agent now remembers how it works best on your brand, privately — while everything it learns about the brand itself is shared with the whole team.',
        'In a group chat more than one agent can answer you, one after the other — each speaks in their own voice, and nobody speaks for a colleague.',
        'Agents no longer consult each other behind the scenes: if a teammate is in the chat, they take the floor and answer you themselves.',
        'A group chat stops when there is nothing left to add, so you get the answers you need and not a round of agreement.',
        'The team on the homepage now follows your cursor — three faces above, two centred below, and the ones on the right turned toward the middle.',
        'A link that points at something specific now lands on it: open a knowledge document from a chat source and the document opens, not just the page.',
        'Panels no longer offer an Open full page button — a page opens where you are working, and stays there.',
        'Spanish and French are fully translated again: the media library, the chat, and every moment an agent asks you to connect an app or open a page no longer switch to English.',
        'The page you are on now stands out in the sidebar — a coloured pill instead of a faint purple label — and stays visible when the sidebar is collapsed.',
        'Sidebar icons, avatars and counters line up on one column, and the section divider that used to hang over nothing is gone.',
        'Clicking a knowledge source in chat opens the document in a panel beside the conversation, already scrolled to the part that was quoted.',
        'A broken or mistyped link now lands on a real Anomalia page that takes you straight back — to your workspace if you are signed in, to the homepage if you are not.',
        'The homepage demo adds three conversations: three agents taking turns in one room, and an agent asking to connect Instagram or Google Drive before it finishes the job.',
        'Onboarding now introduces your team and asks who you want to start with — pick a specialist, and your first chat opens with them.',
        'The intro screens show the real thing: your five specialists looking around, the channels your work goes out to, the apps it reads from, and the routines that keep running.',
        'The team screen now says what it was missing — when no specialist fits the job, you can hire an agent of your own.',
        'A new intro screen shows the work done inside the tools you already use: your product sheets read before the article, so the numbers are the real ones.',
        'Setting up without a website now asks you to tell it more, in a box big enough for more than one line.',
        'New chats start with a specialist instead of a generalist, so you always know whose craft is answering.',
        'The agent picker and the To field now offer the five specialists and your own agents; older chats keep the agent they already have.',
        'Agents hand work to each other by craft: a job always goes to the specialist who owns it.',
        'In a group chat the agents take turns: whoever the message is actually for answers, one at a time, instead of the same agent every time.',
        'Each agent now knows it is in a room and who else is in it — so it stops repeating the others and hands a job to the right specialist instead of doing it badly.',
        'While a group chat is working, the loading avatar shows the agent writing right now, and changes when the turn passes to someone else.',
        'The header of a group chat shows all its members side by side, not just one of them.',
        'The idea bank now rotates: agents see a different set of ideas every time, instead of pitching the same two forever.',
        'An idea that becomes a real post is marked as used and stops coming back, so the bank always shows what is still open.',
        'The disruptive ideas card is gone from the chat; the idea bank has its own page.',
        'A video or photo the AI made now plays right in the conversation instead of arriving as a web address you have to open.',
        'Anomalia can now show you photos and videos right in the chat — one large, several as a grid, videos playing with controls — for anything that is not a post.',
        'The chat no longer dumps a wall of post cards every time an agent looks something up — posts appear only when the agent means to show them to you.',
        'A To field above the message box says who a new chat is for: swap the agent, or add more than one for a group chat.',
        'The home screen lost its page title and subtitle — it is the chat, and the To field already says who you are writing to.',
        'Chat marks the day between messages, and a New messages line shows exactly where you left off.',
        'Weekly post production restarts on its own after an interrupted run, instead of staying quietly stuck.',
        'When production keeps failing, you now see it in your notifications instead of finding out from an empty calendar.',
        'The agent avatar wears the face of the agent you picked — on the home screen and in chat — and morphs into it when you switch.',
        'Agents can now message each other. The exchange happens in its own private thread you can read, and the reply comes back into your chat when it lands.',
        'Your AI team and your automations are one roster now: each agent lists the routines it runs, with a switch per routine, and writes every run into its own thread you can read over time.',
        'Onboarding no longer ends at a paywall: the agent asks which apps you use and offers to connect them right in the chat.',
        'An agent can sign in to GitHub for you: it shows a code in the chat, you approve it in your browser, and it gets on with the work.',
        'Captions are written against explicit rules — no AI tells, no repeated call-to-action across a batch — and the reviewer now flags them by name.',
        'Anomalia learns from your caption edits: the difference between what it wrote and what you kept shapes the next batch.',
        'Text rendered inside images is now read letter by letter before a post ships, and carousel slides keep the same visual thread.',
        'Motion videos get real transitions — full-frame scales, match cuts, elements that carry across a cut — checked on the actual composition, not just promised.',
        'UGC reels are checked for anatomy: wrong hands or extra limbs now block a take.',
        'Music sits under the voice-over, voice clips never overlap, and a video is allowed to run longer so the voice fits.',
        'Every text on a motion video stays legible: no overlaps, real contrast over images and footage.',
        'Message actions moved into one button that appears when you hover a message, with the model, timing and tokens inside.',
        'Tool calls, sources and goal updates are now quiet one-line summaries you can click open, instead of walls of chips.',
        'Competitor ads you find in the library now play, and an agent can study one and turn it into a brief — then shoot your version with your products and your people.',
        'The sidebar is shorter and says where it takes you: Social media opens the calendar, Web opens the blog, Leads opens the finder — and Ads and Designer moved into the panel.',
        'Any page — calendar, content, agents — opens as a panel over what you are doing, so you never lose your place; the page underneath stays exactly where it was.',
        'Settings open as a panel over your work; refreshing or opening the link still gives you the full page.',
        'Chat text is easier to read: better letter spacing, line height and line length, and the same formatting everywhere.',
        'The loading avatar now morphs between expressions and looks around while it works.',
        'The brand you are working on lives in one row at the bottom of the sidebar, with brand switching, your account and settings inside it.',
        'The message box now sits inline with the controls and only grows when you write more than a line; the context meter is gone.',
        'Starting a new chat is instant, the reply no longer flashes twice when it finishes, and the page stops yanking you back to the bottom while you are reading.',
        'The chat reads like a real conversation now: replies sit in their own bubble with the agent face beside them, the column runs full width, and long answers stay easy to read.',
        'Purple text and badges are darker where they sit on light backgrounds, so they pass contrast at a glance.',
        'A motion video can no longer end mid-sentence: the voice-over is checked against the video length before anything renders, and the video is stretched to fit rather than the voice cut.',
        'When a motion video studies a reference, it now actually watches the frames instead of reading a summary — and a video with no real transitions, or with a scene that sits still, no longer passes review.',
        'Press ⌘K to search everything at once — pages, settings, agents, conversations and the words inside them — and open it without leaving where you are.',
        'Keyboard shortcuts throughout: press ? to see them all, and g plus a letter to jump between sections.',
        'The bell now counts only what you have not seen yet, and clears when you open it.',
        'Conversations now group by day, and a line marks where the new messages start.',
        'Creating, editing, pausing or deleting a routine now leaves a line in the chat — click it to see the cadence, the next run and the full brief.',
        'Unread conversations now show how many replies are waiting, not just a dot.',
        'A live conversation shows a green dot on the agent avatar, the way a chat app does.',
      ]
    },
    {
      date: 'August 22, 2026',
      title: 'A chat that never goes quiet',
      items: [
        'Replies generated in the background now show their live progress — the text and the tools as they happen — instead of a silent "Thinking".',
        'If a reply dies mid-work, the conversation says so and offers a Retry button. No more threads stuck on "Thinking" forever.',
        'You can keep typing while the AI is working: your message reaches it right away, mid-task, instead of waiting for the turn to finish.',
        'In Auto, production requests — posts, images, videos, motion, UGC — now run on the most capable model for that turn, and the reply shows which model actually ran.',
        'The onboarding conversation now works towards an explicit goal you can see: study your brand, propose your AI team, then ask what you want to do first.',
        'Voice-over editing no longer fails on a wrong audio address — it finds your real recording and uses that instead.',
      ]
    },
    {
      date: 'August 21, 2026',
      title: 'A clearer chat while agents work',
      items: [
        'Goal updates at the end of a turn are now a proper card — a progress ring, what is done, what is still open, and whether the agent is picking it back up — instead of a wall of raw text. Older conversations get the card too.',
        'While a reply streams, the animated avatar now wears the color of the agent actually answering, in every chat surface.',
        'Conversations with work in progress now animate their avatar in the sidebar as well, with the same loop as the chat.',
        'The elapsed-time label under a streaming reply now lines up with the message text.',
        'Chat text is slightly larger on desktop; mobile stays as it was.',
      ]
    },
    {
      date: 'August 21, 2026',
      title: 'Your AI team, faster chat, and a one-field start',
      items: [
        'Meet your AI team: every recurring agent now has its own chat and its own on/off switch.',
        'Your team starts working the moment you subscribe — each agent introduces itself in chat.',
        'The Strategist and the Analyst now work full turns, like the rest of the team.',
        'Chat now runs on a much faster model — quicker first reply, same tools.',
        'Onboarding is now a single field: your website. The rest is a conversation.',
        'The sidebar is now messaging-style, with your agents at the top.',
        'Unread dots show which conversations have something new.',
        'Agents now send you a message when work is ready — and you can reply to them.',
        'You get a clear heads-up before AI credits run out.',
        'Motion agents now actually watch reference clips before writing scenes.',
        'Deleting a post now also cancels its scheduled publication, from every screen.',
        'Voice-over lines can now be trimmed one by one.',
        'When an agent asks you something in chat, the choices are now full-size buttons — and you can dismiss the question if it does not interest you.',
      ]
    },
    {
      date: 'August 21, 2026',
      title: "The agent's computer",
      items: [
        'Every agent chat now has a side panel: who the agent is, what it is working on right now, and its routines.',
        'The panel shows the agent\'s latest report and its recent runs — including the reason when a run was skipped.',
        'Agents can be paused or resumed straight from their chat, with the same switch as the Agents page.',
        'A video render in progress appears in the panel with its elapsed time.',
        '"Open where it\'s working" jumps to what the agent last touched: the post, the plan, or its home section.',
      ]
    },
    {
      date: 'August 21, 2026',
      title: 'Agent colors, balanced audio, and real video review',
      items: [
        'Background music in motion videos works again, on a new music engine — beds arrive as 30-second clips that repeat under longer videos.',
        'Composer agents each have their own icon and colour again.',
        'Background music now automatically ducks under spoken lines.',
        'Overlapping voice lines no longer collide on the timeline.',
        'Videos now extend a few seconds rather than cut off a line.',
        'Video reviews now actually watch the video, not just the code.',
        'Video reference research now finds relevant examples instead of repeating old posts.',
      ]
    },
    {
      date: 'August 21, 2026',
      title: 'Idea bank, bold ideas, and video quality upgrades',
      items: [
        'UGC videos now keep the same person and product across every shot.',
        'Hiring a recurring agent now needs written confirmation, not a casual yes.',
        'New free tool at /tools/agent-team proposes an agent team from your site.',
        'Bold strategy ideas now appear in chat as a numbered list.',
        'New Idea bank (Brand › Ideas) saves, reuses, and adds your own ideas.',
        'Motion video animations now ease in and out, not constant speed.',
        'Multi-scene videos now render in parallel, finishing faster.',
        'Individual scenes can now be redone without touching the others.',
        'The assistant now renders and looks at frames before calling a video done.',
        'The assistant can now use files, a terminal, and Python in chat.',
        'Files the assistant creates stay attached to the chat, viewable from Motion too.',
        'Motion videos now include voice-over and music by default.',
        'On-screen text and spoken narration are now different and independent.',
        'Interface mockups in videos are now interactive: clicks, typing, results.',
        'Multi-scene UGC videos now vary camera framing, not just action.',
        'The UGC status panel is now scrollable, like Motion\'s.',
        'Finished motion videos can now be requested straight from chat.',
        'Motion videos now include ready-made transitions, shapes, and animated lines.',
      ]
    },
    {
      date: 'August 20, 2026',
      title: 'Goals: work continues until it is done',
      items: [
        'Long tasks now start with a visible checklist that updates live.',
        'Work continues automatically in the background until every item is done.',
        'If it gets stuck, it reports exactly what\'s missing instead of pretending to finish.',
        'New `/goal` command sets, checks, or stops a conversation\'s goal.',
        'Chat commands now open by typing `/`, with filtering and keyboard selection.',
        'Composer menus now close by tapping outside or pressing Esc.',
      ]
    },
    {
      date: 'August 19, 2026',
      title: 'More honest content, more hook variety',
      items: [
        'Posts are now checked for AI-sounding phrasing, not just accuracy.',
        'The AI no longer invents statistics, testimonials, or customer names.',
        'New pre-publish caption review checks captions from five angles.',
        'Eighteen recognized post-opening styles, up from seven, cut repetition.',
        'Brand brief now includes what your product does NOT do and banned claims.',
      ]
    },
    {
      date: 'August 19, 2026',
      title: 'Clearer limits on what analytics can prove',
      items: [
        'Weekly recaps no longer declare winners when the sample size is too small.',
        'Every analysis now states what it could not determine, and why.',
        'Paid campaign issues are now diagnosed by cause, not just flagged.',
        'Quality scores now separate real issues from checks that could not run.',
        'GEO scoring now covers five factors in how AI models cite your brand.',
      ]
    },
    {
      date: 'July 21, 2026',
      title: 'Carousels and in-chat previews',
      items: [
        'The AI assistant can now create multi-slide carousels, not just single images.',
        'New posts now preview directly in the chat conversation.',
        'Content grid now labels carousels and videos at a glance.',
        'Carousel posts can now be browsed slide by slide.',
        'The post edit window now always opens centered on screen.',
      ]
    },
    {
      date: 'July 21, 2026',
      title: 'Radar: new lead sources',
      items: [
        'Radar now also searches Threads and LinkedIn, not just Reddit and news.',
        'Radar finds opportunities even without a connected profile on that platform.',
        'LinkedIn radar surfaces posts where your expertise can win leads.',
      ]
    },
    {
      date: 'July 12, 2026',
      title: 'Blog: categories, authors, search',
      items: [
        'Blog articles can now be organized into categories and tags.',
        'Articles can be assigned an author with photo, bio, and profile page.',
        'New full-text search added to the public blog.',
        'Blog navigation is now customizable, including top bar or sidebar layout.',
        'New AI Humanizer rewrites generated articles to sound more natural.',
        'Blog homepage can now use a fixed left sidebar layout.',
      ]
    },
    {
      date: 'July 12, 2026',
      title: 'Radar and notifications: multilingual',
      items: [
        'Radar sources now support over 30 languages with automatic detection.',
        'Notification emails now go to all brand collaborators, not just the owner.',
        'Each collaborator receives notification emails in their own language.',
      ]
    },
    {
      date: 'July 12, 2026',
      title: 'Social image format fix',
      items: [
        'Instagram and Facebook post images now use the correct format automatically.',
        'The story format was removed since it can\'t auto-publish to the feed.',
      ]
    },
    {
      date: 'July 10, 2026',
      title: 'Blog hosting and custom domain',
      items: [
        'Every brand now gets a dedicated public blog with AI-written, SEO-optimized articles.',
        'Blogs now support a custom domain.',
        'Articles can now publish to Shopify, Webflow, and Wix too.',
        'Articles can now be scheduled for automatic publishing.',
        'AI can now plan a full month of article topics and dates.',
      ]
    },
    {
      date: 'July 8, 2026',
      title: 'Radar: news and trend monitoring',
      items: [
        'Radar now automatically monitors news, subreddits, and RSS feeds.',
        'New daily email digest with the most relevant news and suggested actions.',
        'Suggested sources can now be approved or rejected directly from the email.',
      ]
    },
    {
      date: 'July 5, 2026',
      title: 'SEO and GEO optimization',
      items: [
        'New SEO analysis with a strategic keyword plan.',
        'New GEO audit checks how AI models cite your brand.',
        'Articles can now be auto-generated for target keywords with a quality score.',
        'Articles can now be auto-optimized to reach a 90+ quality score.',
      ]
    },
    {
      date: 'July 1, 2026',
      title: 'Autopilot: automatic content generation',
      items: [
        'Autopilot now generates social posts and blog articles from your weekly plan.',
        'Content is generated in your brand voice, tailored to each platform.',
        'New weekly email recap of activity and performance.',
        'The publishing queue now manages itself, with automatic rollback on errors.',
      ]
    },
  ];

  const isIt = $derived(($locale ?? 'en').startsWith('it'));
</script>

<svelte:head>
  <title>{isIt ? 'Novità' : 'Changelog'} — Anomalia</title>
  <meta name="description" content={isIt ? 'Tutte le novità, miglioramenti e correzioni di Anomalia. Scopri cosa cambia nel prodotto.' : 'All new features, improvements and fixes in Anomalia. See what changed in the product.'} />
  <meta property="og:title" content="{isIt ? 'Novità' : 'Changelog'} — Anomalia" />
  <meta property="og:description" content={isIt ? 'Tutte le novità, miglioramenti e correzioni di Anomalia.' : 'All new features, improvements and fixes in Anomalia.'} />
</svelte:head>

<SiteNav current="" />

<main class="changelog-page">
  <div class="changelog-wrap">
    <header class="changelog-header">
      <p class="cl-eyebrow">{isIt ? 'Novità' : 'Changelog'}</p>
      <h1 class="cl-title">{isIt ? 'Cosa cambia in Anomalia' : 'What changed in Anomalia'}</h1>
      <p class="cl-subtitle">{isIt ? 'Ogni aggiunta, miglioramento e correzione al prodotto — dal più recente al più vecchio.' : 'Every addition, improvement and fix to the product — from most recent to oldest.'}</p>
    </header>

    <div class="timeline">
      {#each entries as entry}
        <section class="entry">
          <div class="entry-marker">
            <span class="entry-date">{entry.date}</span>
          </div>
          <div class="entry-content">
            <h2>{entry.title}</h2>
            <ul>
              {#each entry.items as item}
                <li>{item}</li>
              {/each}
            </ul>
          </div>
        </section>
      {/each}
    </div>
  </div>
</main>

<SiteFooter />

<style>
  .changelog-page {
    min-height: 100vh;
    padding-bottom: 80px;
    padding-top: 56px;
  }
  .changelog-wrap {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .changelog-header {
    text-align: center;
    padding: 64px 0 56px;
  }
  .cl-eyebrow {
    display: inline-block;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent, #7c5cff);
    margin: 0 0 16px;
    padding: 6px 14px;
    border-radius: 980px;
    background: rgba(var(--accent-rgb, 124, 92, 255), 0.07);
    border: 1px solid rgba(var(--accent-rgb, 124, 92, 255), 0.12);
  }
  .cl-title {
    font-family: var(--serif, Georgia, serif);
    font-size: clamp(2.2rem, 4.4vw, 3.6rem);
    font-weight: var(--heading-weight, 700);
    letter-spacing: var(--heading-tracking, -0.02em);
    line-height: 1.12;
    margin: 0 auto 12px;
    max-width: 20ch;
    color: var(--ink, #1a1a1a);
    text-align: center;
  }
  .cl-subtitle {
    font-size: 17px;
    color: var(--ink-soft, #666);
    margin: 0;
    max-width: 520px;
    margin: 0 auto;
    line-height: 1.55;
  }

  .timeline {
    border-left: 2px solid var(--line, #e5e5e5);
    padding-left: 32px;
    margin-left: 0;
  }
  .entry {
    position: relative;
    padding-top: 24px;
    padding-bottom: 40px;
  }
  .entry:last-child {
    padding-bottom: 0;
  }
  .entry-marker {
    position: absolute;
    left: -41px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent, #7c5cff);
    border: 2px solid var(--paper, #fff);
    box-shadow: 0 0 0 2px var(--accent, #7c5cff);
  }
  .entry-date {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-faint, #999);
    margin-bottom: 8px;
    position: absolute;
    left: 32px;
    top: -2px;
    white-space: nowrap;
  }
  .entry-content {
    padding-top: 28px;
  }
  .entry-content h2 {
    font-family: var(--sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
    color: var(--ink, #1a1a1a);
    letter-spacing: -0.01em;
  }
  .entry-content ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .entry-content li {
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-soft, #555);
    padding-left: 18px;
    position: relative;
  }
  .entry-content li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 9px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line, #ddd);
  }

  :global(:root[data-theme="dark"]) .cl-title { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .cl-subtitle { color: #999; }
  :global(:root[data-theme="dark"]) .entry-content h2 { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .entry-content li { color: #aaa; }
  :global(:root[data-theme="dark"]) .timeline { border-color: #333; }
  :global(:root[data-theme="dark"]) .entry-marker { border-color: #1a1a1a; }
  :global(:root[data-theme="dark"]) .entry-content li::before { background: #444; }

  @media (max-width: 640px) {
    .changelog-header { padding: 48px 0 36px; }
    .cl-title { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .timeline { padding-left: 20px; }
    .entry-marker { left: -29px; width: 10px; height: 10px; }
    .entry-date { left: 20px; font-size: 12px; }
    .entry-content { padding-top: 24px; }
  }
</style>
