defmodule OnlookBackendWeb.ChannelCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import OnlookBackendWeb.ChannelCase

      @endpoint OnlookBackendWeb.Endpoint
    end
  end

  setup tags do
    OnlookBackend.DataCase.setup_sandbox(tags)
    :ok
  end
end
