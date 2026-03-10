defmodule OnlookBackend.Studio.Project do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "projects" do
    field :framework, :string
    field :name, :string
    field :source, :string

    has_many :sessions, OnlookBackend.Studio.Session

    timestamps(type: :utc_datetime)
  end

  def changeset(project, attrs) do
    project
    |> cast(attrs, [:framework, :name, :source])
    |> validate_required([:framework, :name, :source])
    |> validate_inclusion(:framework, ["svelte", "react", "vue"])
    |> validate_length(:name, min: 1, max: 120)
    |> validate_length(:source, min: 1)
  end
end
