## Building Vendi
Vendi is a saas platform that will be used by CEOs/PMs (non technical people) to update or maintain an existing project in their org. 
It will allow non technical people to contribute to smaller issues in an org. 
It is different from claude code/devin in the sense that the UI is simpler for non technical people to understand (no code/diffs/terminal errors, simple messages that they can understand)

## Tech stack
 - Node.js for the backend
 - React for the frontend
 - Postgres as the database
 - Prisma as the ORM
 - Tailwind and Shadcn for styling

## Architecture
### Organization setup
 - This is an org level setup to begin with. Anyone from the org can setup the repos for the team.
 - A developer from a company will come, signup, link github (give access to respective repos). If possible give their instructions to locally start the project
 - The non technical person can be invited via a link/given access via email. When the non technical person joins, they should see the project that are listed/setup by the devs.
 - Every team member should link their claude account (assuming they have a claude pro subscription). The underlying agent we are using is claude code. We should store their tokens in the DB, and whenever a user starts a session, we use their claude code token to navigate the session.

### Project setup
 - Every orgs every project needs a one time setup that a developer would do. This would include things like giving a .env file for testing, giving more context to the agent about the project, any extra information if there is to commit (certain patterns in the company).
 - Once the developer clicks on the setup button with this information, we need to 
  - Create a e2b sandbox template for them (add things like postgres if their project uses postgres etc). every project will have its own e2b template with the right dependencies/configuration.
 - Only once this project setup finishes should anyone be allowed to create sessions and talk to the LLM to make changes.

### Post project setup
 - On clicking on "start session" for a particular repo
  - e2b should spinup the respective template.
  - User should see a preview on the right and a chat on the left (so e2b also needs to expose the right ports to the frontend). It should also assume that the user is seeing the website on the frontend and hence the backend url also needs to be exposed via e2b, and set in the .env for the frontend to talk to.
  - Claude code should ofcourse also be part of every sandbox template. That is our agent layer, and that is what will take inputs from the frontend and do its changes, keep the project running (frontend backend etc). The input chat from the user should be sent to the LLM. The output from the LLM shouldnt be sent as such. IT should be refined for non technical people and be minimal. 

### After the changes are done
 - After the PM/CEO is done chatting to the sandbox/claude code and they are confident that the final preview on the right looks good, they will have access to two buttons - Create a PR, commit to main. They should be able to click these buttons to do either of the 2. This should also stop the sandbox.

## List of frontend pages.
 - Signup/Signin page (Support login with google / github).
 - Organization create page (should be able to give access to the github repo and invite other members from their team)
 - Dashboard (should be able to see all the repos of the org. On those repos their should be a "Start new session button" and a "Re-configure" button to re-initialize the e2b template etc)
 - Chat page
