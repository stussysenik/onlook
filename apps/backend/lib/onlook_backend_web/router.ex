defmodule OnlookBackendWeb.Router do
  use OnlookBackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", OnlookBackendWeb do
    pipe_through :api

    post "/projects", ProjectController, :create
    get "/projects/:id", ProjectController, :show
    put "/projects/:id", ProjectController, :update
    get "/projects/:project_id/sessions", SessionController, :index
    post "/sessions", SessionController, :create
  end
end
