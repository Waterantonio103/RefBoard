# Improvements

## UX

- Continue refining interaction feedback and motion so board manipulation feels clear without reducing precision.

## Keyboard and App Behavior

- Add `Ctrl+Z` undo functionality for board actions.
- Fix zoom in/out so it affects only the board canvas, not the whole app UI.
- Fix Select All so it selects all board elements, not application chrome or DOM elements.

## Image Search

- Add an internet-powered image search view.
- Make the search UI visually similar to the Open Board menu.
- Connect search to Google Image Search and potentially high-quality free image sources.
- Allow users to add selected search results directly to the board.


## Multiple Selections

- Users can drag a box around multiple images to select all in the box
- Users can use shift + click, they click on image 1, then holding shift click on image 2 and it will also be selected with image 1
- When multiple images are selected, all normal functions work (delete for example)
- When multiple images are selected, adding a frame will automatically put a frame around all the selected images