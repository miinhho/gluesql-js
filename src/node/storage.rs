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
#[cfg(feature = "redis")]
use {
    gluesql_redis_storage::RedisStorage,
    std::{
        net::{TcpStream, ToSocketAddrs},
        panic,
        time::Duration,
    },
};

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

    #[cfg(feature = "redis")]
    storages.push("redis");

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
    #[cfg(feature = "redis")]
    #[serde(rename_all = "camelCase")]
    Redis {
        namespace: String,
        #[serde(default = "default_redis_host")]
        host: String,
        #[serde(default = "default_redis_port")]
        port: u16,
        #[serde(default = "default_redis_connect_timeout_ms")]
        connect_timeout_ms: u64,
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
            #[cfg(feature = "redis")]
            Self::Redis {
                namespace,
                host,
                port,
                connect_timeout_ms,
            } => open_redis(&namespace, &host, port, connect_timeout_ms).map(box_storage),
        }
    }
}

#[cfg(any(
    feature = "csv",
    feature = "file",
    feature = "json",
    feature = "parquet",
    feature = "redb",
    feature = "redis"
))]
fn box_storage<T: Engine + 'static>(storage: T) -> Box<dyn Engine> {
    Box::new(storage)
}

#[cfg(feature = "redis")]
fn default_redis_host() -> String {
    "127.0.0.1".to_owned()
}

#[cfg(feature = "redis")]
const fn default_redis_port() -> u16 {
    6379
}

#[cfg(feature = "redis")]
const fn default_redis_connect_timeout_ms() -> u64 {
    1_000
}

/// Connects to Redis eagerly so that an unusable server is reported by
/// `addEngine` instead of by the first query.
///
/// `RedisStorage::new` panics on failure, and the panic runs on the JavaScript
/// thread, so the connection is probed first with a bounded timeout and the
/// call itself is wrapped in `catch_unwind` with the default hook muted.
#[cfg(feature = "redis")]
fn open_redis(
    namespace: &str,
    host: &str,
    port: u16,
    connect_timeout_ms: u64,
) -> Result<RedisStorage> {
    let address = (host, port)
        .to_socket_addrs()
        .map_err(|error| Error::StorageMsg(format!("redis: cannot resolve {host}: {error}")))?
        .next()
        .ok_or_else(|| Error::StorageMsg(format!("redis: cannot resolve {host}")))?;

    TcpStream::connect_timeout(&address, Duration::from_millis(connect_timeout_ms)).map_err(
        |error| Error::StorageMsg(format!("redis: cannot connect to {host}:{port}: {error}")),
    )?;

    let hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let opened = panic::catch_unwind(|| RedisStorage::new(namespace, host, port));
    panic::set_hook(hook);

    opened.map_err(|payload| {
        let reason = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("connection failed");

        Error::StorageMsg(format!("redis: {host}:{port}: {reason}"))
    })
}
