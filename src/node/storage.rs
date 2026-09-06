use {
    crate::node::engines::Engine,
    gluesql_core::error::{Error, Result},
    gluesql_memory_storage::MemoryStorage,
    serde::Deserialize,
    serde_json::Value as Json,
};

#[cfg(feature = "csv")]
use gluesql_csv_storage::CsvStorage;
#[cfg(feature = "file")]
use gluesql_file_storage::FileStorage;
#[cfg(feature = "json")]
use gluesql_json_storage::JsonStorage;
#[cfg(feature = "parquet")]
use gluesql_parquet_storage::ParquetStorage;
#[cfg(feature = "redb")]
use gluesql_redb_storage::RedbStorage;

/// Backends compiled into this build, sorted alphabetically.
///
/// Each backend is a cargo feature, so a build only carries what it was asked
/// for. `storages()` is what tells JavaScript which ones are available.
pub fn storages() -> Vec<String> {
    let mut storages = vec!["memory"];

    #[cfg(feature = "redb")]
    storages.push("redb");

    #[cfg(feature = "json")]
    storages.push("json");

    #[cfg(feature = "csv")]
    storages.push("csv");

    #[cfg(feature = "file")]
    storages.push("file");

    #[cfg(feature = "parquet")]
    storages.push("parquet");

    storages.sort_unstable();

    storages.into_iter().map(str::to_owned).collect()
}

/// Storage backend descriptor coming from JavaScript.
///
/// The `storage` field selects the backend and every backend specific option
/// lives in the same object:
///
/// ```javascript
/// db.addEngine('scratch', { storage: 'memory' });
/// ```
///
/// Unknown keys are rejected: a misspelled option would otherwise be dropped
/// silently and hand back a backend configured with defaults. A backend that
/// this build was not compiled with is reported as an unknown `storage` value.
#[derive(Deserialize)]
#[serde(tag = "storage", rename_all = "camelCase", deny_unknown_fields)]
pub enum StorageConfig {
    Memory {},
    #[cfg(feature = "redb")]
    Redb {
        path: String,
    },
    #[cfg(feature = "json")]
    Json {
        path: String,
    },
    #[cfg(feature = "csv")]
    Csv {
        path: String,
    },
    #[cfg(feature = "file")]
    File {
        path: String,
    },
    #[cfg(feature = "parquet")]
    Parquet {
        path: String,
    },
}

impl StorageConfig {
    pub fn parse(config: Json) -> Result<Self> {
        serde_json::from_value(config)
            .map_err(|error| Error::StorageMsg(format!("invalid storage config: {error}")))
    }

    // Infallible when the build carries no backend but `memory`.
    #[allow(clippy::unnecessary_wraps)]
    pub fn open(self) -> Result<Box<dyn Engine>> {
        match self {
            Self::Memory {} => Ok(Box::new(MemoryStorage::default())),
            #[cfg(feature = "redb")]
            Self::Redb { path } => RedbStorage::new(path).map(box_storage),
            #[cfg(feature = "json")]
            Self::Json { path } => JsonStorage::new(path).map(box_storage),
            #[cfg(feature = "csv")]
            Self::Csv { path } => CsvStorage::new(path).map(box_storage),
            #[cfg(feature = "file")]
            Self::File { path } => FileStorage::new(path).map(box_storage),
            #[cfg(feature = "parquet")]
            Self::Parquet { path } => ParquetStorage::new(path).map(box_storage),
        }
    }
}

#[cfg(any(
    feature = "csv",
    feature = "file",
    feature = "json",
    feature = "parquet",
    feature = "redb"
))]
fn box_storage<T: Engine + 'static>(storage: T) -> Box<dyn Engine> {
    Box::new(storage)
}
