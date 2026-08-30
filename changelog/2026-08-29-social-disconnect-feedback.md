# Social disconnect feedback

The confirmation form used enhanced submission without an in-flight state, so a slow disconnect looked stuck and could be submitted again. The page now tracks the selected account, disables both confirmation actions, shows the existing localized deletion label, and clears the state even when the action fails. A focused page contract test guards the affordance.
